import {
  generationRow,
  loadGenerationInput,
  type GenerationRow,
} from "../../../packages/data/src/generation";
import { DomainError } from "../../../packages/domain/src/contracts";
import {
  CONTRACT,
  MODEL,
  renderOutput,
  sha256,
  type Snapshot,
} from "../../../packages/domain/src/generation";
import {
  callAnthropic,
  ProviderFailure,
  validateEnvelope,
  providerMetadata,
  RESPONSE_LIMIT,
} from "./anthropic";
export type GenerationBindings = Pick<JobsBindings, "DB" | "PRIVATE_FILES"> & {
  GENERATION_ENABLED: string;
  ANTHROPIC_API_KEY?: string;
};
type Attempt = {
  attempt: number;
  state: string;
  response_key: string;
  response_hash: string | null;
  response_bytes: number | null;
  failure_code: string | null;
  provider_request_id: string | null;
};
const stamp = () => new Date().toISOString();
export async function failGeneration(db: D1Database, id: string, code: string) {
  await db.batch([
    db
      .prepare(
        "UPDATE generation_requests SET state='failed',failure_code=?,finished_at=?,updated_at=? WHERE id=? AND state IN ('queued','running')",
      )
      .bind(code, stamp(), stamp(), id),
    db
      .prepare(
        "INSERT INTO audit_events(id,actor_user_id,action,entity_type,entity_id,created_at) SELECT ?,user_id,'generation_failed','generation',id,? FROM generation_requests WHERE id=? AND changes()=1",
      )
      .bind(crypto.randomUUID(), stamp(), id),
    db
      .prepare(
        "UPDATE draft_applications SET execution_status='failed' WHERE execution_status IN ('queued','running') AND EXISTS(SELECT 1 FROM generation_inputs i JOIN generation_requests r ON r.id=i.request_id WHERE i.request_id=? AND r.state='failed' AND i.draft_id=draft_applications.id AND i.user_id=draft_applications.user_id AND i.expected_revision=draft_applications.revision)",
      )
      .bind(id),
  ]);
  return { done: true, state: "failed" };
}
async function ownedInput(env: GenerationBindings, r: GenerationRow) {
  const loaded = await loadGenerationInput(
    env.DB,
    r.user_id,
    {
      savedJobId: r.saved_job_id,
      profileId: r.profile_id,
      profileVersionId: r.profile_version_id,
      jobVersionId: r.job_version_id,
    },
    false,
  );
  const target = await env.DB.prepare(
    "SELECT 1 FROM draft_applications WHERE id=? AND user_id=? AND saved_job_id=?",
  )
    .bind(r.draft_id, r.user_id, r.saved_job_id)
    .first();
  if (!target) throw new DomainError("not_found", 404);
  if (
    (await sha256(loaded.jobJson)) !== r.job_hash ||
    (await sha256(loaded.profileJson)) !== r.profile_hash
  )
    throw new DomainError("input_integrity_mismatch", 409);
  return loaded.snapshot;
}
async function snapshot(env: GenerationBindings, r: GenerationRow) {
  const input = await ownedInput(env, r),
    text = JSON.stringify(input);
  if ((await sha256(text)) !== r.snapshot_hash)
    throw new DomainError("input_integrity_mismatch", 409);
  let object = await env.PRIVATE_FILES.get(r.snapshot_key);
  if (!object) {
    await env.PRIVATE_FILES.put(r.snapshot_key, text, {
      sha256: r.snapshot_hash,
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: "application/json" },
    });
    object = await env.PRIVATE_FILES.get(r.snapshot_key);
  }
  if (!object || object.size !== r.snapshot_bytes) {
    await object?.body.cancel();
    throw new DomainError("snapshot_integrity_mismatch", 409);
  }
  const bytes = await object.arrayBuffer();
  if ((await sha256(bytes)) !== r.snapshot_hash)
    throw new DomainError("snapshot_integrity_mismatch", 409);
  await env.DB.prepare(
    "UPDATE generation_snapshots SET state='ready',updated_at=? WHERE request_id=?",
  )
    .bind(stamp(), r.id)
    .run();
  return input;
}
async function finalize(
  env: GenerationBindings,
  r: GenerationRow,
  input: Snapshot,
  output: unknown,
) {
  const review = renderOutput(output, input),
    version = crypto.randomUUID(),
    t = stamp(),
    q = (sql: string, ...args: (string | number | null)[]) =>
      env.DB.prepare(sql).bind(...args);
  await env.DB.batch([
    q(
      "INSERT INTO generation_write_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM generation_requests WHERE id=? AND state='running') AND EXISTS(SELECT 1 FROM generation_snapshots WHERE request_id=? AND state='ready') AND EXISTS(SELECT 1 FROM generation_attempts WHERE request_id=? AND state='stored') AND EXISTS(SELECT 1 FROM draft_applications WHERE id=? AND user_id=? AND saved_job_id=? AND revision=? AND approved_revision IS ? AND status IS NOT 'Approved') AND EXISTS(SELECT 1 FROM saved_jobs WHERE id=? AND user_id=? AND status IN ('Saved','Draft Requested','Draft Ready')) AND EXISTS(SELECT 1 FROM candidate_profiles WHERE id=? AND user_id=? AND archived_at IS NULL) THEN 1 ELSE 0 END)",
      r.id,
      r.id,
      r.id,
      r.id,
      r.draft_id,
      r.user_id,
      r.saved_job_id,
      r.expected_revision,
      r.expected_approved_revision,
      r.saved_job_id,
      r.user_id,
      r.profile_id,
      r.user_id,
    ),
    q(
      "UPDATE draft_applications SET cover_letter=?,short_answers=NULL,status='Ready for Review',execution_status='succeeded',provenance='generation',profile_id=?,profile_version_id=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?",
      review.coverLetter,
      r.profile_id,
      r.profile_version_id,
      t,
      r.draft_id,
      r.user_id,
    ),
    q(
      "INSERT INTO draft_versions(id,draft_id,user_id,revision,cover_letter,short_answers,reviewer_notes,status,created_at) SELECT ?,id,user_id,revision,cover_letter,short_answers,reviewer_notes,status,? FROM draft_applications WHERE id=? AND user_id=?",
      version,
      t,
      r.draft_id,
      r.user_id,
    ),
    q(
      "INSERT INTO generation_results VALUES(?,?,?,?)",
      r.id,
      version,
      JSON.stringify(review),
      t,
    ),
    q(
      "UPDATE generation_requests SET state='succeeded',failure_code=NULL,finished_at=?,updated_at=? WHERE id=?",
      t,
      t,
      r.id,
    ),
    q(
      "UPDATE saved_jobs SET status='Draft Ready',revision=revision+1,updated_at=? WHERE id=? AND user_id=? AND status IN ('Saved','Draft Requested')",
      t,
      r.saved_job_id,
      r.user_id,
    ),
    q(
      "INSERT INTO audit_events(id,actor_user_id,action,entity_type,entity_id,revision,created_at) VALUES(?,?,'generation_completed','draft',?,?,?)",
      crypto.randomUUID(),
      r.user_id,
      r.draft_id,
      r.expected_revision + 1,
      t,
    ),
    q("DELETE FROM generation_write_guards WHERE id=?", r.id),
  ]);
}
async function storeAttempt(
  env: GenerationBindings,
  r: GenerationRow,
  a: Attempt,
  text: string,
  requestId: string | null,
) {
  // Persist the bounded response first, including invalid responses, for recoverable validation.
  const artifact = JSON.stringify({
    requestId,
    body: JSON.parse(text) as unknown,
  });
  const hash = await sha256(artifact);
  await env.PRIVATE_FILES.put(a.response_key, artifact, {
    sha256: hash,
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType: "application/json" },
  });
  const saved = await env.PRIVATE_FILES.get(a.response_key);
  if (!saved || saved.size > RESPONSE_LIMIT + 500) {
    await saved?.body.cancel();
    throw new ProviderFailure("response_integrity_mismatch");
  }
  const body = await saved.text();
  if ((await sha256(body)) !== hash)
    throw new ProviderFailure("response_integrity_mismatch");
  await env.DB.prepare(
    "UPDATE generation_attempts SET state='stored',finished_at=?,response_hash=?,response_bytes=?,provider_request_id=? WHERE request_id=? AND attempt=? AND state='calling'",
  )
    .bind(
      stamp(),
      hash,
      new TextEncoder().encode(body).byteLength,
      requestId,
      r.id,
      a.attempt,
    )
    .run();
  return { body: JSON.parse(text) as unknown, requestId };
}
export async function advanceGeneration(
  env: GenerationBindings,
  id: string,
  fetcher: typeof fetch = fetch,
) {
  const r = await generationRow(env.DB, id);
  if (!["queued", "running"].includes(r.state))
    return { done: true, state: r.state };
  if (env.GENERATION_ENABLED !== "true" || !env.ANTHROPIC_API_KEY)
    return failGeneration(env.DB, id, "generation_stopped");
  if (r.model !== MODEL || r.contract !== CONTRACT)
    return failGeneration(env.DB, id, "contract_unavailable");
  try {
    const input = await snapshot(env, r);
    let a = await env.DB.prepare(
      "SELECT * FROM generation_attempts WHERE request_id=? ORDER BY attempt DESC LIMIT 1",
    )
      .bind(id)
      .first<Attempt>();
    let stored: { body: unknown; requestId: string | null } | null = null;
    if (a?.state === "stored" || a?.state === "calling") {
      const object = await env.PRIVATE_FILES.get(a.response_key);
      if (object) {
        if (object.size > RESPONSE_LIMIT + 500) {
          await object.body.cancel();
          throw new ProviderFailure("response_integrity_mismatch");
        }
        const text = await object.text(),
          hash = await sha256(text);
        if (a.response_hash && hash !== a.response_hash)
          throw new ProviderFailure("response_integrity_mismatch");
        stored = JSON.parse(text) as {
          body: unknown;
          requestId: string | null;
        };
        if (a.state === "calling")
          await env.DB.prepare(
            "UPDATE generation_attempts SET state='stored',finished_at=?,response_hash=?,response_bytes=?,provider_request_id=? WHERE request_id=? AND attempt=? AND state='calling'",
          )
            .bind(
              stamp(),
              hash,
              new TextEncoder().encode(text).byteLength,
              stored.requestId,
              id,
              a.attempt,
            )
            .run();
      } else if (a.state === "calling") {
        await env.DB.prepare(
          "UPDATE generation_attempts SET state='ambiguous',finished_at=?,failure_code='provider_acceptance_unknown' WHERE request_id=? AND attempt=?",
        )
          .bind(stamp(), id, a.attempt)
          .run();
        return failGeneration(env.DB, id, "provider_acceptance_unknown");
      } else throw new ProviderFailure("response_integrity_mismatch");
    }
    if (!stored) {
      if (
        a &&
        !(
          a.state === "rejected" &&
          a.failure_code === "provider_rate_limited" &&
          a.attempt < 2
        )
      )
        return failGeneration(
          env.DB,
          id,
          a.failure_code ?? "provider_attempt_exhausted",
        );
      const next = (a?.attempt ?? 0) + 1,
        key =
          "generation/" + r.user_id + "/" + id + "/response-" + next + ".json";
      const batch = await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO generation_attempts(request_id,attempt,state,model,started_at,response_key) VALUES(?,?,'calling',?,?,?) ON CONFLICT(request_id,attempt) DO NOTHING",
        ).bind(id, next, MODEL, stamp(), key),
        env.DB.prepare(
          "UPDATE generation_requests SET state='running',updated_at=? WHERE id=? AND state='queued'",
        ).bind(stamp(), id),
      ]);
      if (!batch[0].meta.changes) return { done: false, state: "running" };
      a = {
        attempt: next,
        state: "calling",
        response_key: key,
        response_hash: null,
        response_bytes: null,
        failure_code: null,
        provider_request_id: null,
      };
      // Repeat mutable authorization immediately before the only provider side effect.
      await ownedInput(env, r);
      if (env.GENERATION_ENABLED !== "true")
        return { done: false, state: "stopped" };
      let response: Awaited<ReturnType<typeof callAnthropic>>;
      try {
        response = await callAnthropic(env.ANTHROPIC_API_KEY, input, fetcher);
      } catch (e) {
        const failure =
          e instanceof ProviderFailure
            ? e
            : new ProviderFailure("provider_acceptance_unknown", true);
        await env.DB.prepare(
          "UPDATE generation_attempts SET state=?,failure_code=?,finished_at=?,provider_request_id=? WHERE request_id=? AND attempt=? AND state='calling'",
        )
          .bind(
            failure.ambiguous ? "ambiguous" : "rejected",
            failure.code,
            stamp(),
            failure.requestId,
            id,
            next,
          )
          .run();
        if (failure.retryable && next < 2)
          return { done: false, state: "retryable" };
        return failGeneration(env.DB, id, failure.code);
      }
      // Storage failures must retry recovery, never turn a saved response into a new billable call.
      stored = await storeAttempt(env, r, a, response.text, response.requestId);
    }
    const metadata = providerMetadata(stored.body);
    if (metadata)
      await env.DB.prepare(
        "UPDATE generation_attempts SET provider_message_id=?,finish_reason=?,usage_json=?,response_model=? WHERE request_id=? AND attempt=?",
      )
        .bind(
          metadata.messageId,
          metadata.finishReason,
          JSON.stringify(metadata.usage),
          metadata.model,
          id,
          a!.attempt,
        )
        .run();
    const validated = validateEnvelope(stored.body);
    try {
      await finalize(env, r, input, validated.output);
    } catch (e) {
      if ((await generationRow(env.DB, id)).state === "succeeded")
        return { done: true, state: "succeeded" };
      if (e instanceof DomainError || e instanceof ProviderFailure) throw e;
      // Only revision/outcome conflicts are terminal; unexpected SQL failures retry using stored response.
      const d = await env.DB.prepare(
        "SELECT revision,status FROM draft_applications WHERE id=?",
      )
        .bind(r.draft_id)
        .first<{ revision: number; status: string }>();
      const s = await env.DB.prepare("SELECT status FROM saved_jobs WHERE id=?")
        .bind(r.saved_job_id)
        .first<string>("status");
      if (
        d?.revision !== r.expected_revision ||
        d.status === "Approved" ||
        !["Saved", "Draft Requested", "Draft Ready"].includes(s ?? "")
      )
        return failGeneration(env.DB, id, "revision_conflict");
      throw e;
    }
    return { done: true, state: "succeeded" };
  } catch (e) {
    if (e instanceof DomainError || e instanceof ProviderFailure) {
      await env.DB.prepare(
        "UPDATE generation_attempts SET failure_code=?,state=CASE WHEN state='calling' THEN 'rejected' ELSE state END WHERE request_id=? AND attempt=(SELECT max(attempt) FROM generation_attempts WHERE request_id=?)",
      )
        .bind(e.code, id, id)
        .run();
      return failGeneration(env.DB, id, e.code);
    }
    // Infrastructure failures propagate so a Workflow retry can recover immutable R2 evidence.
    throw new Error("generation_storage_unavailable");
  }
}
