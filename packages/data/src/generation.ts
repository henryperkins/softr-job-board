import { UserFlowService } from "./user-flows";
import { DomainError } from "../../domain/src/contracts";
import {
  buildSnapshot,
  CONTRACT,
  generationSchema,
  MODEL,
  sha256,
  type GenerationInput,
} from "../../domain/src/generation";
export type GenerationRow = {
  id: string;
  user_id: string;
  saved_job_id: string;
  profile_id: string;
  profile_version_id: string;
  state: string;
  intent_hash: string;
  workflow_id: string;
  failure_code: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
  draft_id: string;
  job_id: string;
  job_version_id: string;
  expected_revision: number;
  expected_approved_revision: number | null;
  job_hash: string;
  profile_hash: string;
  snapshot_key: string;
  snapshot_hash: string;
  snapshot_bytes: number;
  model: string;
  contract: string;
};
export async function generationRow(db: D1Database, id: string) {
  const row = await db
    .prepare(
      "SELECT r.*,i.* FROM generation_requests r JOIN generation_inputs i ON i.request_id=r.id WHERE r.id=?",
    )
    .bind(id)
    .first<GenerationRow>();
  if (!row) throw new DomainError("not_found", 404);
  return row;
}
export async function loadGenerationInput(
  db: D1Database,
  user: string,
  input: Pick<
    GenerationInput,
    "savedJobId" | "profileId" | "profileVersionId" | "jobVersionId"
  >,
  current = true,
) {
  const service = new UserFlowService(db, { id: user, name: "", email: "" });
  const save = await service.save(input.savedJobId),
    profile = await service.profile(input.profileId);
  if (profile.archived_at) throw new DomainError("profile_archived", 409);
  if (
    ["Submitted", "Archived", "Rejected", "Offer"].includes(save.status ?? "")
  )
    throw new DomainError("saved_job_unavailable", 409);
  const version = await db
    .prepare(
      "SELECT content_json,archived_at FROM profile_versions WHERE id=? AND profile_id=? AND user_id=?",
    )
    .bind(input.profileVersionId, input.profileId, user)
    .first<{ content_json: string; archived_at: string | null }>();
  if (!version) throw new DomainError("not_found", 404);
  if (version.archived_at) throw new DomainError("profile_archived", 409);
  const job = await db
    .prepare(
      "SELECT v.content_json FROM job_versions v JOIN jobs j ON j.id=v.job_id WHERE v.id=? AND v.job_id=?" +
        (current ? " AND v.revision=j.revision" : ""),
    )
    .bind(input.jobVersionId, save.job_id)
    .first<{ content_json: string }>();
  if (!job) throw new DomainError("job_version_conflict", 409);
  return {
    save,
    profileJson: version.content_json,
    jobJson: job.content_json,
    snapshot: buildSnapshot(version.content_json, job.content_json),
  };
}
export class GenerationService extends UserFlowService {
  async request(
    raw: GenerationInput,
    options: { enabled: boolean; dailyLimit?: number; inflightLimit?: number },
  ) {
    if (!options.enabled) throw new DomainError("generation_unavailable", 503);
    const parsed = generationSchema.safeParse(raw);
    if (!parsed.success) throw new DomainError("invalid_request", 400);
    const input = parsed.data,
      intentHash = await sha256(JSON.stringify(input));
    const prior = async () => {
      const r = await this.db
        .prepare(
          "SELECT id,intent_hash FROM generation_requests WHERE user_id=? AND idempotency_key=?",
        )
        .bind(this.actor.id, input.idempotencyKey)
        .first<{ id: string; intent_hash: string }>();
      if (!r) return null;
      if (r.intent_hash !== intentHash)
        throw new DomainError("idempotency_conflict", 409);
      return this.status(r.id);
    };
    const existing = await prior();
    if (existing) return existing;
    const loaded = await loadGenerationInput(this.db, this.actor.id, input);
    if (input.resumeId) {
      const file = await this.db
        .prepare(
          "SELECT id FROM attachments WHERE id=? AND user_id=? AND profile_id=?",
        )
        .bind(input.resumeId, this.actor.id, input.profileId)
        .first();
      if (!file) throw new DomainError("not_found", 404);
      const parent = JSON.parse(loaded.profileJson) as {
        attachmentIds?: string[];
      };
      if (!parent.attachmentIds?.includes(input.resumeId))
        throw new DomainError("resume_version_mismatch", 409);
      throw new DomainError("resume_extraction_unavailable", 409);
    }
    const target = input.draftId ? await this.draft(input.draftId) : null;
    if (target && target.saved_job_id !== loaded.save.id)
      throw new DomainError("draft_saved_job_mismatch", 409);
    if (
      target &&
      (target.revision !== input.expectedRevision ||
        target.status === "Approved")
    )
      throw new DomainError("revision_conflict", 409);
    if (
      !target &&
      (await this.db
        .prepare(
          "SELECT id FROM draft_applications WHERE saved_job_id=? AND user_id=?",
        )
        .bind(loaded.save.id, this.actor.id)
        .first())
    ) {
      const concurrent = await prior();
      if (concurrent) return concurrent;
      throw new DomainError("draft_selection_required", 409);
    }
    const id = crypto.randomUUID(),
      draftId = target?.id ?? crypto.randomUUID(),
      stamp = new Date().toISOString(),
      text = JSON.stringify(loaded.snapshot);
    const daily = Math.max(
        1,
        Math.min(
          20,
          Number.isFinite(options.dailyLimit)
            ? Math.floor(options.dailyLimit!)
            : 5,
        ),
      ),
      inflight = Math.max(
        1,
        Math.min(
          5,
          Number.isFinite(options.inflightLimit)
            ? Math.floor(options.inflightLimit!)
            : 2,
        ),
      );
    const q = (sql: string, ...v: (string | number | null)[]) =>
      this.db.prepare(sql).bind(...v);
    try {
      await this.db.batch([
        q(
          "INSERT INTO generation_write_guards VALUES(?,CASE WHEN (SELECT count(*) FROM generation_requests WHERE user_id=? AND created_at>=?)<? AND (SELECT count(*) FROM generation_requests WHERE user_id=? AND state IN ('queued','running'))<? AND EXISTS(SELECT 1 FROM candidate_profiles WHERE id=? AND user_id=? AND archived_at IS NULL) AND EXISTS(SELECT 1 FROM saved_jobs s JOIN job_versions v ON v.job_id=s.job_id JOIN jobs j ON j.id=s.job_id WHERE s.id=? AND s.user_id=? AND s.status IN ('Saved','Draft Requested','Draft Ready') AND v.id=? AND v.revision=j.revision) AND " +
            (target
              ? "EXISTS(SELECT 1 FROM draft_applications WHERE id=? AND user_id=? AND saved_job_id=? AND revision=? AND status IS NOT 'Approved')"
              : "NOT EXISTS(SELECT 1 FROM draft_applications WHERE saved_job_id=? AND user_id=?)") +
            " THEN 1 ELSE 0 END)",
          id,
          this.actor.id,
          new Date(Date.now() - 86400000).toISOString(),
          daily,
          this.actor.id,
          inflight,
          input.profileId,
          this.actor.id,
          loaded.save.id,
          this.actor.id,
          input.jobVersionId,
          ...(target
            ? [draftId, this.actor.id, loaded.save.id, input.expectedRevision!]
            : [loaded.save.id, this.actor.id]),
        ),
        ...(!target
          ? [
              q(
                "INSERT INTO draft_applications(id,user_id,saved_job_id,profile_id,profile_version_id,status,execution_status,provenance,created_at,updated_at) VALUES(?,?,?,?,?,'In Progress','queued','generation',?,?)",
                draftId,
                this.actor.id,
                loaded.save.id,
                input.profileId,
                input.profileVersionId,
                stamp,
                stamp,
              ),
              q(
                "INSERT INTO draft_versions(id,draft_id,user_id,revision,status,created_at) VALUES(?,?,?,1,'In Progress',?)",
                crypto.randomUUID(),
                draftId,
                this.actor.id,
                stamp,
              ),
            ]
          : []),
        q(
          "INSERT INTO generation_requests(id,user_id,saved_job_id,profile_id,profile_version_id,idempotency_key,state,workflow_id,created_at,updated_at,intent_hash) VALUES(?,?,?,?,?,?,'queued',?,?,?,?)",
          id,
          this.actor.id,
          loaded.save.id,
          input.profileId,
          input.profileVersionId,
          input.idempotencyKey,
          "generate-" + id,
          stamp,
          stamp,
          intentHash,
        ),
        q(
          "INSERT INTO generation_inputs(request_id,user_id,draft_id,saved_job_id,job_id,job_version_id,profile_id,profile_version_id,expected_revision,expected_approved_revision,job_hash,profile_hash,snapshot_key,snapshot_hash,snapshot_bytes,model,contract) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          id,
          this.actor.id,
          draftId,
          loaded.save.id,
          loaded.save.job_id,
          input.jobVersionId,
          input.profileId,
          input.profileVersionId,
          target?.revision ?? 1,
          target?.approved_revision ?? null,
          await sha256(loaded.jobJson),
          await sha256(loaded.profileJson),
          "generation/" + this.actor.id + "/" + id + "/input.json",
          await sha256(text),
          new TextEncoder().encode(text).byteLength,
          MODEL,
          CONTRACT,
        ),
        q("INSERT INTO generation_snapshots VALUES(?,'pending',?)", id, stamp),
        q(
          "INSERT INTO outbox(id,kind,aggregate_id,idempotency_key,state,available_at,created_at) VALUES(?,'generate-draft',?,?,'pending',?,?)",
          id,
          id,
          "generate-" + id,
          stamp,
          stamp,
        ),
        q(
          "INSERT INTO audit_events(id,actor_user_id,action,entity_type,entity_id,created_at) VALUES(?,?,'generation_requested','generation',?,?)",
          crypto.randomUUID(),
          this.actor.id,
          id,
          stamp,
        ),
        q(
          "UPDATE saved_jobs SET status='Draft Requested',revision=revision+1,updated_at=? WHERE id=? AND user_id=? AND status='Saved'",
          stamp,
          loaded.save.id,
          this.actor.id,
        ),
        q("DELETE FROM generation_write_guards WHERE id=?", id),
      ]);
    } catch (e) {
      const duplicate = await prior();
      if (duplicate) return duplicate;
      if (e instanceof DomainError) throw e;
      throw new DomainError("generation_limit_or_conflict", 409);
    }
    return this.status(id);
  }
  async status(id: string) {
    const r = await generationRow(this.db, id);
    if (r.user_id !== this.actor.id) throw new DomainError("not_found", 404);
    const attempts = await this.db
      .prepare(
        "SELECT attempt,state,model,started_at AS startedAt,finished_at AS finishedAt,failure_code AS failureCode,provider_request_id AS providerRequestId,provider_message_id AS providerMessageId,finish_reason AS finishReason,usage_json AS usageJson FROM generation_attempts WHERE request_id=? ORDER BY attempt",
      )
      .bind(id)
      .all();
    const outbox = await this.db
      .prepare(
        "SELECT state,attempts,last_error AS failureCode FROM outbox WHERE kind='generate-draft' AND aggregate_id=?",
      )
      .bind(id)
      .first();
    const result = await this.db
      .prepare(
        "SELECT review_json,draft_version_id FROM generation_results WHERE request_id=?",
      )
      .bind(id)
      .first<{ review_json: string; draft_version_id: string }>();
    return {
      id: r.id,
      state: r.state,
      failureCode: r.failure_code,
      draftId: r.draft_id,
      profileId: r.profile_id,
      profileVersionId: r.profile_version_id,
      jobVersionId: r.job_version_id,
      expectedRevision: r.expected_revision,
      model: r.model,
      contract: r.contract,
      resumeContentsUsed: false,
      attempts: attempts.results,
      dispatch: outbox,
      review: result ? (JSON.parse(result.review_json) as unknown) : null,
      provenance: {
        actorId: r.user_id,
        requestId: r.id,
        savedJobId: r.saved_job_id,
        jobId: r.job_id,
        jobVersionId: r.job_version_id,
        jobHash: r.job_hash,
        profileId: r.profile_id,
        profileVersionId: r.profile_version_id,
        profileHash: r.profile_hash,
        inputHash: r.snapshot_hash,
        contract: r.contract,
        model: r.model,
        createdAt: r.created_at,
        finishedAt: r.finished_at,
        draftVersionId: result?.draft_version_id ?? null,
      },
    };
  }
  async options(savedId: string) {
    const s = await this.save(savedId);
    const profiles = await this.db
      .prepare(
        "SELECT p.id AS profileId,p.name,v.id AS versionId,v.revision FROM candidate_profiles p JOIN profile_versions v ON v.profile_id=p.id AND v.user_id=p.user_id WHERE p.user_id=? AND p.archived_at IS NULL AND v.archived_at IS NULL ORDER BY p.name,v.revision DESC LIMIT 200",
      )
      .bind(this.actor.id)
      .all();
    const job = await this.db
      .prepare(
        "SELECT v.id FROM job_versions v JOIN jobs j ON j.id=v.job_id AND j.revision=v.revision WHERE j.id=?",
      )
      .bind(s.job_id)
      .first<{ id: string }>();
    const rows = await this.db
      .prepare(
        "SELECT id FROM generation_requests WHERE saved_job_id=? AND user_id=? AND intent_hash IS NOT NULL ORDER BY created_at DESC,id DESC LIMIT 10",
      )
      .bind(s.id, this.actor.id)
      .all<{ id: string }>();
    return {
      profiles: profiles.results,
      jobVersionId: job?.id ?? null,
      requests: await Promise.all(rows.results.map((r) => this.status(r.id))),
    };
  }
}
