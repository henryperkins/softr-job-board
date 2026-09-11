import { failGeneration, type GenerationBindings } from "./generation";
import { generationRow } from "../../../packages/data/src/generation";
export type GenerateParams = { requestId: string };
export interface GenerationWorkflow {
  create(options: { id: string; params: GenerateParams }): Promise<unknown>;
  get(id: string): Promise<Pick<WorkflowInstance, "status">>;
}
export async function dispatchGeneration(
  env: GenerationBindings & { GENERATE_DRAFT: GenerationWorkflow },
  now = new Date(),
) {
  if (env.GENERATION_ENABLED !== "true" || !env.ANTHROPIC_API_KEY) return;
  const db = env.DB,
    t = now.toISOString();
  const active = await db
    .prepare(
      "SELECT r.id,r.workflow_id FROM generation_requests r JOIN outbox o ON o.aggregate_id=r.id AND o.kind='generate-draft' WHERE r.state IN ('queued','running') AND o.state='delivered' AND o.available_at<=? ORDER BY o.available_at,r.id LIMIT 25",
    )
    .bind(t)
    .all<{ id: string; workflow_id: string }>();
  for (const r of active.results) {
    try {
      const instance = await env.GENERATE_DRAFT.get(r.workflow_id),
        status = await instance.status();
      if (["errored", "terminated", "complete"].includes(status.status))
        await failGeneration(db, r.id, "workflow_execution_failed");
    } catch {
      /* Unknown control-plane state is never permission to create a new instance. */
    }
    await db
      .prepare(
        "UPDATE outbox SET available_at=? WHERE kind='generate-draft' AND aggregate_id=? AND state='delivered'",
      )
      .bind(new Date(now.getTime() + 60000).toISOString(), r.id)
      .run();
  }
  // Same abandoned-final-lease recovery as the reviewed ingestion dispatcher.
  await db
    .prepare(
      "UPDATE outbox SET state='failed',lease_until=NULL,last_error='dispatch_lease_exhausted' WHERE kind='generate-draft' AND state='dispatching' AND attempts>=5 AND lease_until<=?",
    )
    .bind(t)
    .run();
  const exhausted = await db
    .prepare(
      "SELECT o.aggregate_id FROM outbox o JOIN generation_requests r ON r.id=o.aggregate_id WHERE o.kind='generate-draft' AND o.state='failed' AND r.state IN ('queued','running') LIMIT 25",
    )
    .all<{ aggregate_id: string }>();
  for (const r of exhausted.results)
    await failGeneration(db, r.aggregate_id, "dispatch_unconfirmed");
  const rows = await db
    .prepare(
      "SELECT id,aggregate_id,attempts FROM outbox WHERE kind='generate-draft' AND state IN ('pending','dispatching') AND available_at<=? AND (lease_until IS NULL OR lease_until<=?) AND attempts<5 ORDER BY available_at,id LIMIT 10",
    )
    .bind(t, t)
    .all<{ id: string; aggregate_id: string; attempts: number }>();
  for (const row of rows.results) {
    const lease = new Date(now.getTime() + 60000).toISOString();
    const claim = await db
      .prepare(
        "UPDATE outbox SET state='dispatching',attempts=attempts+1,lease_until=? WHERE id=? AND attempts=? AND state IN ('pending','dispatching') AND (lease_until IS NULL OR lease_until<=?)",
      )
      .bind(lease, row.id, row.attempts, t)
      .run();
    if (!claim.meta.changes) continue;
    const r = await generationRow(db, row.aggregate_id);
    try {
      if (["queued", "running"].includes(r.state)) {
        try {
          await env.GENERATE_DRAFT.create({
            id: r.workflow_id,
            params: { requestId: r.id },
          });
        } catch {
          const instance = await env.GENERATE_DRAFT.get(r.workflow_id),
            status = await instance.status();
          if (status.status === "unknown") throw new Error("unknown");
          if (
            ["errored", "terminated", "complete"].includes(status.status) &&
            (await generationRow(db, r.id)).state !== "succeeded"
          )
            await failGeneration(db, r.id, "workflow_execution_failed");
        }
      }
      await db
        .prepare(
          "UPDATE outbox SET state='delivered',lease_until=NULL,last_error=NULL WHERE id=? AND lease_until=?",
        )
        .bind(row.id, lease)
        .run();
    } catch {
      const failed = row.attempts + 1 >= 5;
      await db
        .prepare(
          "UPDATE outbox SET state=?,lease_until=NULL,last_error='dispatch_unconfirmed',available_at=? WHERE id=? AND lease_until=?",
        )
        .bind(
          failed ? "failed" : "pending",
          new Date(now.getTime() + 60000 * 2 ** row.attempts).toISOString(),
          row.id,
          lease,
        )
        .run();
      if (failed) await failGeneration(db, r.id, "dispatch_unconfirmed");
    }
  }
}
