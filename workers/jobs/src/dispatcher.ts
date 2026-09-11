import { assertWrites, getRun, type IngestionBindings } from "./ingestion.ts";
import {
  IngestionError,
  sourceSchema,
  sources,
  type Source,
} from "./providers.ts";
export type IngestParams = { runId: string };
export interface WorkflowDispatch {
  create(options: { id: string; params: IngestParams }): Promise<unknown>;
  get(id: string): Promise<Pick<WorkflowInstance, "status" | "restart">>;
}
export function chicagoClock(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    eligible: Number(part("hour")) >= 7,
  };
}
export async function acquireRun(
  db: D1Database,
  source: Source,
  date: string,
  now = new Date().toISOString(),
) {
  sourceSchema.parse(source);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date
  )
    throw new IngestionError("invalid_date");
  const id = `ingest-${source.replaceAll(":", "-")}-${date}`;
  await db.batch([
    db
      .prepare(
        "INSERT INTO ingestion_runs(id,source,chicago_date,state,created_at,updated_at,workflow_id) VALUES(?,?,?,'queued',?,?,?) ON CONFLICT(source,chicago_date) DO NOTHING",
      )
      .bind(id, source, date, now, now, id),
    db
      .prepare(
        "INSERT INTO outbox(id,kind,aggregate_id,idempotency_key,state,available_at,created_at) SELECT ?,'ingest-source',id,?,'pending',?,? FROM ingestion_runs WHERE id=? AND state='queued' ON CONFLICT(idempotency_key) DO NOTHING",
      )
      .bind(id, id, now, now, id),
  ]);
  return getRun(db, id);
}
// Only this outbox kind is consumed; GenerateDraftWorkflow can own its own kind.
export async function drainOutbox(
  db: D1Database,
  workflow: WorkflowDispatch,
  now = new Date(),
  limit = 10,
) {
  const stamp = now.toISOString();
  // A crash after claiming the final attempt must not strand the row forever.
  await db
    .prepare(
      "UPDATE outbox SET state='failed',lease_until=NULL,last_error='dispatch_lease_exhausted' WHERE kind='ingest-source' AND state='dispatching' AND attempts>=5 AND lease_until<=?",
    )
    .bind(stamp)
    .run();
  const rows = await db
    .prepare(
      "SELECT id,aggregate_id,attempts FROM outbox WHERE kind='ingest-source' AND state IN ('pending','dispatching') AND available_at<=? AND (lease_until IS NULL OR lease_until<=?) AND attempts<5 ORDER BY available_at,id LIMIT ?",
    )
    .bind(stamp, stamp, Math.min(limit, 25))
    .all<{ id: string; aggregate_id: string; attempts: number }>();
  for (const row of rows.results) {
    const claim = await db
      .prepare(
        "UPDATE outbox SET state='dispatching',attempts=attempts+1,lease_until=? WHERE id=? AND attempts=? AND (lease_until IS NULL OR lease_until<=?) AND state IN ('pending','dispatching')",
      )
      .bind(
        new Date(now.getTime() + 60000).toISOString(),
        row.id,
        row.attempts,
        stamp,
      )
      .run();
    if (!claim.meta.changes) continue;
    const run = await getRun(db, row.aggregate_id);
    try {
      if (["succeeded", "review"].includes(run.state)) {
        await db
          .prepare(
            "UPDATE outbox SET state='delivered',lease_until=NULL WHERE id=?",
          )
          .bind(row.id)
          .run();
        continue;
      }
      // create may succeed remotely and lose its response. Every attempt uses the same ID.
      try {
        await workflow.create({
          id: run.workflow_id,
          params: { runId: run.id },
        });
      } catch {
        const instance = await workflow.get(run.workflow_id);
        const status = await instance.status();
        if (status.status === "unknown")
          throw new IngestionError("dispatch_unknown");
      }
      await db
        .prepare(
          "UPDATE outbox SET state='delivered',last_error=NULL,lease_until=NULL WHERE id=?",
        )
        .bind(row.id)
        .run();
    } catch {
      await db
        .prepare(
          "UPDATE outbox SET state=?,last_error='dispatch_unconfirmed',lease_until=NULL,available_at=? WHERE id=?",
        )
        .bind(
          row.attempts + 1 >= 5 ? "failed" : "pending",
          new Date(
            now.getTime() + Math.min(3600000, 60000 * 2 ** row.attempts),
          ).toISOString(),
          row.id,
        )
        .run();
    }
  }
}
export async function dispatchSchedule(
  env: IngestionBindings & {
    INGESTION_SCHEDULE_ENABLED: string;
    INGEST_SOURCE: WorkflowDispatch;
  },
  now: Date,
) {
  if (
    env.INGESTION_SCHEDULE_ENABLED !== "true" ||
    env.INGESTION_WRITES_ENABLED !== "true"
  )
    return;
  const clock = chicagoClock(now);
  if (clock.eligible)
    await Promise.allSettled(
      sources.map((source) =>
        acquireRun(env.DB, source, clock.date, now.toISOString()),
      ),
    );
  await drainOutbox(env.DB, env.INGEST_SOURCE, now);
}
// Trusted tooling only, never mounted on the public HTTP Worker.
export async function inspectRun(db: D1Database, runId: string) {
  const run = await getRun(db, runId);
  const counts = await db
    .prepare(
      "SELECT state,action,count(*) AS count FROM ingestion_backlog WHERE run_id=? GROUP BY state,action",
    )
    .bind(run.id)
    .all();
  const pages = await db
    .prepare(
      "SELECT page,checksum,bytes,row_count,staged_count,complete,captured_at FROM ingestion_pages WHERE run_id=? ORDER BY page",
    )
    .bind(run.id)
    .all();
  const reviews = await db
    .prepare(
      "SELECT reason,count(*) AS count FROM ingestion_reviews WHERE run_id=? GROUP BY reason",
    )
    .bind(run.id)
    .all();
  const outbox = await db
    .prepare(
      "SELECT state,attempts,available_at,last_error FROM outbox WHERE kind='ingest-source' AND aggregate_id=?",
    )
    .bind(run.id)
    .first();
  const progress = await db
    .prepare(
      "SELECT failure_code,created_count,updated_count,unchanged_count,closed_count,rejected_count,created_at,updated_at,captured_at,finished_at FROM ingestion_runs WHERE id=?",
    )
    .bind(run.id)
    .first();
  const observation = await db
    .prepare(
      "SELECT last_success_at,row_count FROM source_observations WHERE source=?",
    )
    .bind(run.source)
    .first();
  // Do not return raw provider data, URLs, cursor contents, credentials, or exception messages.
  return {
    id: run.id,
    source: run.source,
    date: run.chicago_date,
    state: run.state,
    snapshotComplete: !!run.snapshot_complete,
    captureDone: !!run.capture_done,
    hasCursor: run.cursor !== null,
    retryRevision: run.retry_revision,
    counts: counts.results,
    pages: pages.results,
    reviews: reviews.results,
    progress,
    outbox,
    lastSuccessfulObservation: observation,
  };
}
export async function retryRun(
  env: IngestionBindings,
  workflow: WorkflowDispatch,
  runId: string,
  expectedRevision: number,
) {
  assertWrites(env);
  const run = await getRun(env.DB, runId);
  if (
    run.state !== "failed" ||
    run.retry_revision !== expectedRevision ||
    expectedRevision >= 5
  )
    throw new IngestionError("retry_state_conflict");
  if (
    await env.DB.prepare(
      "SELECT 1 FROM source_observations WHERE source=? AND last_success_at>?",
    )
      .bind(run.source, run.captured_at ?? run.chicago_date)
      .first()
  )
    throw new IngestionError("stale_run");
  const instance = await workflow.get(run.workflow_id),
    status = await instance.status();
  if (!["errored", "terminated", "complete"].includes(status.status))
    throw new IngestionError("workflow_not_stopped");
  // Audit intent before restart; ambiguous restarts stay inspectable, never create a new ID.
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE ingestion_runs SET state='queued',failure_code='restart_pending',retry_revision=retry_revision+1,updated_at=? WHERE id=? AND state='failed' AND retry_revision=?",
    ).bind(new Date().toISOString(), runId, expectedRevision),
    env.DB.prepare(
      "INSERT INTO audit_events(id,action,entity_type,entity_id,revision,created_at) VALUES(?,'ingestion.retry','ingestion_run',?,?,?)",
    ).bind(
      `${runId}:retry:${expectedRevision + 1}`,
      runId,
      expectedRevision + 1,
      new Date().toISOString(),
    ),
  ]);
  try {
    await instance.restart();
    await env.DB.prepare(
      "UPDATE ingestion_runs SET failure_code=NULL WHERE id=? AND failure_code='restart_pending'",
    )
      .bind(runId)
      .run();
  } catch {
    await env.DB.prepare(
      "UPDATE ingestion_runs SET failure_code='restart_unconfirmed' WHERE id=?",
    )
      .bind(runId)
      .run();
    throw new IngestionError("restart_unconfirmed");
  }
}

export async function recoverRestart(
  env: IngestionBindings,
  workflow: WorkflowDispatch,
  runId: string,
  expectedRevision: number,
) {
  assertWrites(env);
  const run = await getRun(env.DB, runId);
  const pending = await env.DB.prepare(
    "SELECT failure_code FROM ingestion_runs WHERE id=?",
  )
    .bind(runId)
    .first<string>("failure_code");
  if (
    run.retry_revision !== expectedRevision ||
    !["restart_pending", "restart_unconfirmed"].includes(pending ?? "")
  )
    throw new IngestionError("restart_state_conflict");
  const instance = await workflow.get(run.workflow_id),
    status = await instance.status();
  if (status.status === "unknown")
    throw new IngestionError("restart_unconfirmed");
  if (
    ["errored", "terminated", "complete"].includes(status.status) &&
    !["succeeded", "review"].includes(run.state)
  )
    await instance.restart();
  await env.DB.prepare(
    "UPDATE ingestion_runs SET failure_code=NULL WHERE id=? AND failure_code IN ('restart_pending','restart_unconfirmed')",
  )
    .bind(runId)
    .run();
}

export async function retryDispatch(
  env: IngestionBindings,
  runId: string,
  expectedRevision: number,
) {
  assertWrites(env);
  const run = await getRun(env.DB, runId);
  if (
    run.state !== "queued" ||
    run.retry_revision !== expectedRevision ||
    expectedRevision >= 5
  )
    throw new IngestionError("dispatch_retry_conflict");
  const stamp = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO ingestion_transaction_guards(id,valid) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM outbox WHERE kind='ingest-source' AND aggregate_id=? AND state='failed' AND attempts=5) THEN 1 ELSE 0 END)",
    ).bind(crypto.randomUUID(), runId),
    env.DB.prepare(
      "UPDATE outbox SET state='pending',attempts=0,available_at=?,lease_until=NULL,last_error=NULL WHERE kind='ingest-source' AND aggregate_id=?",
    ).bind(stamp, runId),
    env.DB.prepare(
      "UPDATE ingestion_runs SET retry_revision=retry_revision+1,updated_at=? WHERE id=? AND retry_revision=?",
    ).bind(stamp, runId, expectedRevision),
    env.DB.prepare(
      "INSERT INTO audit_events(id,action,entity_type,entity_id,revision,created_at) VALUES(?,'ingestion.dispatch_retry','ingestion_run',?,?,?)",
    ).bind(
      `${runId}:retry:${expectedRevision + 1}`,
      runId,
      expectedRevision + 1,
      stamp,
    ),
  ]);
}
