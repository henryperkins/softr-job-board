import {
  failureCode,
  fetchPage,
  IngestionError,
  normalize,
  parsePage,
  sha256,
  sourceSchema,
  type NormalizedJob,
  type ProviderSecrets,
  type Source,
} from "./providers.ts";

export interface IngestionBindings extends ProviderSecrets {
  DB: D1Database;
  PRIVATE_FILES: R2Bucket;
  INGESTION_WRITES_ENABLED: string;
  CLOSURE_MAX_FRACTION?: string;
  CLOSURE_MAX_COUNT?: string;
}
export interface Run {
  id: string;
  source: Source;
  chicago_date: string;
  state: string;
  cursor: string | null;
  workflow_id: string;
  page_count: number;
  capture_done: number;
  snapshot_complete: number;
  captured_at: string | null;
  retry_revision: number;
  rejected_count: number;
}
interface StoredPage {
  page: number;
  object_key: string;
  checksum: string;
  request_cursor: string | null;
  row_count: number;
  staged_count: number;
  complete: number;
  captured_at: string;
}
export function assertWrites(env: IngestionBindings) {
  if (env.INGESTION_WRITES_ENABLED !== "true")
    throw new IngestionError("writes_disabled");
}
export async function getRun(db: D1Database, id: string) {
  const run = await db
    .prepare("SELECT * FROM ingestion_runs WHERE id=?")
    .bind(id)
    .first<Run>();
  if (!run) throw new IngestionError("unknown_run");
  sourceSchema.parse(run.source);
  return run;
}
export async function markFailure(db: D1Database, id: string, error: unknown) {
  await db
    .prepare(
      "UPDATE ingestion_runs SET state='failed',failure_code=?,updated_at=? WHERE id=? AND state NOT IN ('succeeded','review')",
    )
    .bind(failureCode(error), new Date().toISOString(), id)
    .run();
}
function decode(raw: Uint8Array) {
  try {
    return JSON.parse(new TextDecoder().decode(raw)) as unknown;
  } catch {
    throw new IngestionError("malformed_json");
  }
}

// All large payloads remain in private R2 or D1, never a Workflow step result.
export async function capturePage(
  env: IngestionBindings,
  run: Run,
  raw: Uint8Array,
  capturedAt = new Date().toISOString(),
) {
  assertWrites(env);
  const checksum = await sha256(raw),
    key = `ingestion/${run.id}/pages/${run.page_count}/${checksum}.json`;
  await env.PRIVATE_FILES.put(key, raw, {
    sha256: checksum,
    onlyIf: { etagDoesNotMatch: "*" },
    customMetadata: { source: run.source, capturedAt, checksum },
    httpMetadata: { contentType: "application/json" },
  });
  // Failed raw responses are still immutable evidence, even when parsing fails.
  let page;
  try {
    page = parsePage(run.source, decode(raw), run.cursor);
  } catch (e) {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO ingestion_reviews(id,run_id,reason,details_json,created_at) VALUES(?,?,'invalid_capture',?,?)",
    )
      .bind(
        `${run.id}:capture:${run.page_count}:${checksum}`,
        run.id,
        JSON.stringify({
          objectKey: key,
          checksum,
          bytes: raw.byteLength,
          code: failureCode(e),
        }),
        capturedAt,
      )
      .run();
    throw e;
  }
  if (
    page.nextCursor !== null &&
    (await env.DB.prepare(
      "SELECT 1 FROM ingestion_pages WHERE run_id=? AND request_cursor=?",
    )
      .bind(run.id, page.nextCursor)
      .first())
  )
    throw new IngestionError("repeated_cursor");
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO ingestion_pages(run_id,page,request_cursor,next_cursor,object_key,checksum,bytes,captured_at,row_count,complete) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(run_id,page) DO NOTHING",
    ).bind(
      run.id,
      run.page_count,
      run.cursor,
      page.nextCursor,
      key,
      checksum,
      raw.byteLength,
      capturedAt,
      page.rows.length,
      Number(page.complete),
    ),
    env.DB.prepare(
      "UPDATE ingestion_runs SET cursor=?,page_count=page_count+1,capture_done=?,captured_at=?,state='capturing',updated_at=? WHERE id=? AND page_count=?",
    ).bind(
      page.nextCursor,
      Number(page.complete),
      capturedAt,
      capturedAt,
      run.id,
      run.page_count,
    ),
  ]);
}
async function stagePage(env: IngestionBindings, run: Run, page: StoredPage) {
  const object = await env.PRIVATE_FILES.get(page.object_key);
  if (!object) throw new IngestionError("missing_capture");
  const raw = new Uint8Array(await object.arrayBuffer());
  if ((await sha256(raw)) !== page.checksum)
    throw new IngestionError("capture_checksum_mismatch");
  const parsed = parsePage(run.source, decode(raw), page.request_cursor);
  const end = Math.min(page.staged_count + 25, parsed.rows.length),
    statements: D1PreparedStatement[] = [],
    seen = new Set<string>();
  for (let i = page.staged_count; i < end; i++) {
    try {
      const job = normalize(run.source, parsed.rows[i]),
        json = JSON.stringify(job);
      if (new TextEncoder().encode(json).length > 200000)
        throw new IngestionError("record_bytes_limit");
      const hash = await sha256(json);
      // Duplicate source IDs invalidate full-snapshot completeness, even across pages.
      if (
        seen.has(job.externalId) ||
        (await env.DB.prepare(
          "SELECT 1 FROM ingestion_backlog WHERE run_id=? AND external_id=?",
        )
          .bind(run.id, job.externalId)
          .first())
      )
        throw new IngestionError("duplicate_external_id");
      seen.add(job.externalId);
      statements.push(
        env.DB.prepare(
          "INSERT INTO ingestion_backlog(run_id,external_id,page,content_json,content_hash) VALUES(?,?,?,?,?)",
        ).bind(run.id, job.externalId, page.page, json, hash),
      );
    } catch (e) {
      statements.push(
        env.DB.prepare(
          "INSERT OR IGNORE INTO ingestion_reviews(id,run_id,reason,details_json,created_at) VALUES(?,?,'rejected_row',?,?)",
        ).bind(
          `${run.id}:row:${page.page}:${i}`,
          run.id,
          JSON.stringify({ page: page.page, index: i, code: failureCode(e) }),
          page.captured_at,
        ),
      );
      statements.push(
        env.DB.prepare(
          "UPDATE ingestion_runs SET rejected_count=rejected_count+1 WHERE id=?",
        ).bind(run.id),
      );
    }
  }
  statements.push(
    env.DB.prepare(
      "UPDATE ingestion_pages SET staged_count=? WHERE run_id=? AND page=? AND staged_count=?",
    ).bind(end, run.id, page.page, page.staged_count),
  );
  // Protect against a replay racing an operator; each stage chunk commits once.
  statements.unshift(
    env.DB.prepare(
      "INSERT INTO ingestion_transaction_guards(id,valid) SELECT ?,CASE WHEN staged_count=? THEN 1 ELSE 0 END FROM ingestion_pages WHERE run_id=? AND page=?",
    ).bind(
      `${run.id}:stage:${page.page}:${page.staged_count}:${crypto.randomUUID()}`,
      page.staged_count,
      run.id,
      page.page,
    ),
  );
  await env.DB.batch(statements);
}
interface ExistingJob {
  id: string;
  revision: number;
  owner_source: string | null;
  owner_external: string | null;
  content_json: string | null;
}
async function upsert(
  env: IngestionBindings,
  run: Run,
  row: { external_id: string; content_json: string; content_hash: string },
) {
  const job = JSON.parse(row.content_json) as NormalizedJob;
  const alias = await env.DB.prepare(
    "SELECT job_id FROM ingestion_source_jobs WHERE source=? AND external_id=?",
  )
    .bind(run.source, row.external_id)
    .first<{ job_id: string }>();
  let jobId = alias?.job_id,
    review: string | null = null;
  if (!jobId && job.canonicalUrl) {
    const matches = await env.DB.prepare(
      "SELECT DISTINCT job_id FROM job_sources WHERE source_url=? UNION SELECT job_id FROM ingestion_source_jobs WHERE canonical_url=?",
    )
      .bind(job.canonicalUrl, job.canonicalUrl)
      .all<{ job_id: string }>();
    if (matches.results.length === 1) jobId = matches.results[0].job_id;
    else if (matches.results.length > 1) review = "ambiguous_exact_url";
  }
  if (!job.canonicalUrl) review = "no_job_specific_canonical_url";
  // URL-derived ID serializes concurrent first sightings; ambiguous evidence stays separate.
  jobId ??= `ing-${await sha256(!review && job.canonicalUrl ? job.canonicalUrl : `${run.source}:${row.external_id}`)}`;
  const existing = await env.DB.prepare(
    "SELECT j.id,j.revision,o.source AS owner_source,o.external_id AS owner_external,v.content_json FROM jobs j LEFT JOIN job_source_owners o ON o.job_id=j.id LEFT JOIN job_versions v ON v.job_id=j.id AND v.revision=j.revision WHERE j.id=?",
  )
    .bind(jobId)
    .first<ExistingJob>();
  const owns =
    !existing?.owner_source ||
    (existing.owner_source === run.source &&
      existing.owner_external === row.external_id);
  const changed = owns && existing?.content_json !== row.content_json;
  const action = !existing ? "created" : changed ? "updated" : "unchanged";
  const stamp = run.captured_at!,
    core = job.core,
    revision = existing ? existing.revision + Number(changed) : 1;
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      "INSERT INTO ingestion_transaction_guards(id,valid) VALUES(?,CASE WHEN NOT EXISTS(SELECT 1 FROM source_observations WHERE source=? AND last_success_at>?) THEN 1 ELSE 0 END)",
    ).bind(crypto.randomUUID(), run.source, stamp),
    env.DB.prepare(
      "INSERT INTO ingestion_transaction_guards(id,valid) VALUES(?,CASE WHEN NOT EXISTS(SELECT 1 FROM ingestion_source_jobs WHERE source=? AND external_id=? AND observed_at>?) THEN 1 ELSE 0 END)",
    ).bind(crypto.randomUUID(), run.source, row.external_id, stamp),
    env.DB.prepare(
      "INSERT INTO ingestion_transaction_guards(id,valid) VALUES(?,CASE WHEN COALESCE((SELECT revision FROM jobs WHERE id=?),0)=? AND (SELECT state FROM ingestion_backlog WHERE run_id=? AND external_id=?)='pending' THEN 1 ELSE 0 END)",
    ).bind(
      crypto.randomUUID(),
      jobId,
      existing?.revision ?? 0,
      run.id,
      row.external_id,
    ),
  ];
  if (!existing)
    statements.push(
      env.DB.prepare(
        "INSERT INTO jobs(id,title,company,location,remote,employment,seniority,source_url,description,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      ).bind(
        jobId,
        core.title,
        core.company,
        core.location,
        core.remote,
        core.employment,
        core.seniority,
        core.source_url,
        core.description,
        core.status,
        stamp,
        stamp,
      ),
    );
  else if (changed)
    statements.push(
      env.DB.prepare(
        "UPDATE jobs SET title=?,company=?,location=?,remote=?,employment=?,seniority=?,source_url=?,description=?,status=?,revision=?,updated_at=? WHERE id=?",
      ).bind(
        core.title,
        core.company,
        core.location,
        core.remote,
        core.employment,
        core.seniority,
        core.source_url,
        core.description,
        core.status,
        revision,
        stamp,
        jobId,
      ),
    );
  statements.push(
    env.DB.prepare(
      "INSERT OR IGNORE INTO job_source_owners(job_id,source,external_id) VALUES(?,?,?)",
    ).bind(jobId, run.source, row.external_id),
  );
  if (changed) {
    statements.push(
      env.DB.prepare(
        "INSERT INTO job_versions(id,job_id,revision,content_json,created_at) VALUES(?,?,?,?,?)",
      ).bind(`${jobId}:v${revision}`, jobId, revision, row.content_json, stamp),
    );
    statements.push(
      env.DB.prepare(
        "INSERT INTO audit_events(id,action,entity_type,entity_id,revision,created_at) VALUES(?,?,'job',?,?,?)",
      ).bind(
        `${jobId}:ingestion:v${revision}`,
        `ingestion.${action}`,
        jobId,
        revision,
        stamp,
      ),
    );
  }
  statements.push(
    env.DB.prepare(
      "INSERT INTO job_sources(id,job_id,source_system,source_key,source_url,first_seen_at,last_seen_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(source_system,source_key) DO UPDATE SET source_url=excluded.source_url,last_seen_at=excluded.last_seen_at",
    ).bind(
      `src-${await sha256(`${run.source}:${row.external_id}`)}`,
      jobId,
      run.source,
      row.external_id,
      core.source_url,
      stamp,
      stamp,
    ),
  );
  statements.push(
    env.DB.prepare(
      "INSERT INTO ingestion_source_jobs(source,external_id,job_id,canonical_url,content_json,content_hash,observed_run_id,observed_at,status) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(source,external_id) DO UPDATE SET canonical_url=excluded.canonical_url,content_json=excluded.content_json,content_hash=excluded.content_hash,observed_run_id=excluded.observed_run_id,observed_at=excluded.observed_at,status=excluded.status",
    ).bind(
      run.source,
      row.external_id,
      jobId,
      job.canonicalUrl,
      row.content_json,
      row.content_hash,
      run.id,
      stamp,
      core.status,
    ),
  );
  statements.push(
    env.DB.prepare(
      "UPDATE ingestion_backlog SET state='done',action=?,job_id=? WHERE run_id=? AND external_id=?",
    ).bind(action, jobId, run.id, row.external_id),
  );
  statements.push(
    env.DB.prepare(
      `UPDATE ingestion_runs SET ${action}_count=${action}_count+1,updated_at=? WHERE id=?`,
    ).bind(new Date().toISOString(), run.id),
  );
  if (review)
    statements.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO ingestion_reviews(id,run_id,external_id,reason,details_json,created_at) VALUES(?,?,?,?,?,?)",
      ).bind(
        `${run.id}:identity:${row.external_id}`,
        run.id,
        row.external_id,
        review,
        "{}",
        stamp,
      ),
    );
  await env.DB.batch(statements);
}
async function finish(env: IngestionBindings, run: Run) {
  const count =
    (await env.DB.prepare(
      "SELECT count(*) AS n FROM ingestion_backlog WHERE run_id=?",
    )
      .bind(run.id)
      .first<number>("n")) ?? 0;
  const now = new Date().toISOString(),
    statements: D1PreparedStatement[] = [
      env.DB.prepare(
        "INSERT INTO ingestion_transaction_guards(id,valid) VALUES(?,CASE WHEN NOT EXISTS(SELECT 1 FROM source_observations WHERE source=? AND last_success_at>?) THEN 1 ELSE 0 END)",
      ).bind(crypto.randomUUID(), run.source, run.captured_at),
    ];
  if (run.source.startsWith("greenhouse:")) {
    const absent = await env.DB.prepare(
      "SELECT s.job_id,s.external_id,j.revision,v.content_json FROM ingestion_source_jobs s JOIN job_source_owners o ON o.job_id=s.job_id AND o.source=s.source AND o.external_id=s.external_id JOIN jobs j ON j.id=s.job_id JOIN job_versions v ON v.job_id=j.id AND v.revision=j.revision WHERE s.source=? AND s.status='Open' AND s.observed_at<=? AND NOT EXISTS(SELECT 1 FROM ingestion_backlog b WHERE b.run_id=? AND b.external_id=s.external_id)",
    )
      .bind(run.source, run.captured_at, run.id)
      .all<{
        job_id: string;
        external_id: string;
        revision: number;
        content_json: string;
      }>();
    const previous =
      (await env.DB.prepare(
        "SELECT count(*) AS n FROM ingestion_source_jobs WHERE source=? AND status='Open' AND observed_at<=?",
      )
        .bind(run.source, run.captured_at)
        .first<number>("n")) ?? 0;
    const fraction = Number(env.CLOSURE_MAX_FRACTION ?? "0.1"),
      maximum = Number(env.CLOSURE_MAX_COUNT ?? "25");
    if (
      !Number.isFinite(fraction) ||
      fraction < 0 ||
      fraction > 0.1 ||
      !Number.isInteger(maximum) ||
      maximum < 0 ||
      maximum > 25
    )
      throw new IngestionError("invalid_closure_config");
    if (
      count === 0 ||
      absent.results.length > maximum ||
      absent.results.length / Math.max(previous, 1) > fraction
    ) {
      await env.DB.batch([
        ...statements,
        env.DB.prepare(
          "INSERT INTO source_observations(source,last_success_at,run_id,row_count) VALUES(?,?,?,?) ON CONFLICT(source) DO UPDATE SET last_success_at=excluded.last_success_at,run_id=excluded.run_id,row_count=excluded.row_count WHERE excluded.last_success_at>=source_observations.last_success_at",
        ).bind(run.source, run.captured_at, run.id, count),
        env.DB.prepare(
          "INSERT OR IGNORE INTO ingestion_reviews(id,run_id,reason,details_json,created_at) VALUES(?,?,'closure_circuit_breaker',?,?)",
        ).bind(
          `${run.id}:closure`,
          run.id,
          JSON.stringify({
            observed: count,
            absent: absent.results.length,
            previous,
            fraction,
            maximum,
          }),
          now,
        ),
        env.DB.prepare(
          "UPDATE ingestion_runs SET state='review',failure_code='closure_review_required',finished_at=?,updated_at=? WHERE id=?",
        ).bind(now, now, run.id),
      ]);
      return;
    }
    // Absence is immutable run membership, not the mutable last-observed pointer.
    // Recheck membership and source freshness inside the same transaction as closure:
    // a newer unchanged observation changes neither the job revision nor run summary.
    // At most 25 closures. Version + audit + status + final run commit together.
    for (const row of absent.results) {
      const content = JSON.parse(row.content_json) as NormalizedJob;
      content.core.status = "Closed";
      const rev = row.revision + 1;
      statements.push(
        env.DB.prepare(
          "INSERT INTO ingestion_transaction_guards(id,valid) VALUES(?,CASE WHEN (SELECT revision FROM jobs WHERE id=?)=? AND EXISTS(SELECT 1 FROM ingestion_source_jobs s JOIN job_source_owners o ON o.job_id=s.job_id AND o.source=s.source AND o.external_id=s.external_id WHERE s.source=? AND s.external_id=? AND s.job_id=? AND s.status='Open' AND s.observed_at<=? AND NOT EXISTS(SELECT 1 FROM ingestion_backlog b WHERE b.run_id=? AND b.external_id=s.external_id)) THEN 1 ELSE 0 END)",
        ).bind(
          crypto.randomUUID(),
          row.job_id,
          row.revision,
          run.source,
          row.external_id,
          row.job_id,
          run.captured_at,
          run.id,
        ),
      );
      statements.push(
        env.DB.prepare(
          "UPDATE jobs SET status='Closed',revision=?,updated_at=? WHERE id=?",
        ).bind(rev, now, row.job_id),
      );
      statements.push(
        env.DB.prepare(
          "INSERT INTO job_versions(id,job_id,revision,content_json,created_at) VALUES(?,?,?,?,?)",
        ).bind(
          `${row.job_id}:v${rev}`,
          row.job_id,
          rev,
          JSON.stringify(content),
          now,
        ),
      );
      statements.push(
        env.DB.prepare(
          "INSERT INTO audit_events(id,action,entity_type,entity_id,revision,created_at) VALUES(?,'ingestion.closed','job',?,?,?)",
        ).bind(`${row.job_id}:ingestion:v${rev}`, row.job_id, rev, now),
      );
      statements.push(
        env.DB.prepare(
          "UPDATE ingestion_source_jobs SET status='Closed' WHERE source=? AND external_id=?",
        ).bind(run.source, row.external_id),
      );
    }
    statements.push(
      env.DB.prepare(
        "UPDATE ingestion_runs SET closed_count=? WHERE id=?",
      ).bind(absent.results.length, run.id),
    );
  }
  statements.push(
    env.DB.prepare(
      "INSERT INTO source_observations(source,last_success_at,run_id,row_count) VALUES(?,?,?,?) ON CONFLICT(source) DO UPDATE SET last_success_at=excluded.last_success_at,run_id=excluded.run_id,row_count=excluded.row_count WHERE excluded.last_success_at>=source_observations.last_success_at",
    ).bind(run.source, run.captured_at, run.id, count),
  );
  statements.push(
    env.DB.prepare(
      "UPDATE ingestion_runs SET state='succeeded',finished_at=?,updated_at=?,failure_code=NULL WHERE id=?",
    ).bind(now, now, run.id),
  );
  await env.DB.batch(statements);
}

export async function advanceIngestion(
  env: IngestionBindings,
  runId: string,
  fetcher: typeof fetch = fetch,
  maxPages = 200,
): Promise<{ done: boolean; state: string }> {
  assertWrites(env);
  const run = await getRun(env.DB, runId);
  if (["succeeded", "review", "failed"].includes(run.state))
    return { done: true, state: run.state };
  try {
    const pending = await env.DB.prepare(
      "SELECT * FROM ingestion_pages WHERE run_id=? AND staged_count<row_count ORDER BY page LIMIT 1",
    )
      .bind(run.id)
      .first<StoredPage>();
    if (pending) await stagePage(env, run, pending);
    else if (!run.capture_done) {
      if (run.page_count >= maxPages * (run.retry_revision + 1))
        throw new IngestionError("page_limit");
      await capturePage(
        env,
        run,
        await fetchPage(run.source, run.cursor, env, fetcher),
      );
    } else if (!run.snapshot_complete) {
      if (run.rejected_count) throw new IngestionError("rejected_records");
      await env.DB.prepare(
        "UPDATE ingestion_runs SET snapshot_complete=1,state='importing',updated_at=? WHERE id=?",
      )
        .bind(new Date().toISOString(), run.id)
        .run();
    } else {
      const backlog = await env.DB.prepare(
        "SELECT external_id,content_json,content_hash FROM ingestion_backlog WHERE run_id=? AND state='pending' ORDER BY external_id LIMIT 10",
      )
        .bind(run.id)
        .all<{
          external_id: string;
          content_json: string;
          content_hash: string;
        }>();
      if (backlog.results.length)
        for (const row of backlog.results) await upsert(env, run, row);
      else await finish(env, run);
    }
    return { done: false, state: "progress" };
  } catch (e) {
    await markFailure(env.DB, runId, e);
    throw e;
  }
}
