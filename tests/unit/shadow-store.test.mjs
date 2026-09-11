import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openShadowStore } from "../../scripts/ingestion/local-store.ts";
import { acquireRun } from "../../workers/jobs/src/dispatcher.ts";
import { capturePage } from "../../workers/jobs/src/ingestion.ts";

test("local shadow persists D1 and raw R2 across disposal/reopen and re-normalizes unchanged", async () => {
  const temporaryBase = await realpath(os.tmpdir()),
    root = await mkdtemp(path.join(temporaryBase, "job-board-shadow-test-")),
    directory = path.join(root, "store");
  let runtime;
  try {
    runtime = await openShadowStore(directory, true);
    const raw = new TextEncoder().encode(
      JSON.stringify({
        jobs: [
          {
            id: 1,
            title: "Engineer",
            absolute_url: "https://synthetic.test/jobs/1",
            content: "<p>Full text</p>",
          },
        ],
        meta: { total: 1 },
      }),
    );
    const first = await acquireRun(
      runtime.env.DB,
      "greenhouse:stripe",
      "2026-09-11",
    );
    await capturePage(runtime.env, first, raw, "2026-09-11T12:00:00Z");
    assert.equal((await runtime.advance(first.id)).state, "succeeded");
    const key = await runtime.env.DB.prepare(
      "SELECT object_key FROM ingestion_pages WHERE run_id=?",
    )
      .bind(first.id)
      .first("object_key");
    await runtime.dispose();
    runtime = undefined;
    runtime = await openShadowStore(directory);
    assert.equal(
      await runtime.env.DB.prepare("SELECT count(*) n FROM jobs").first("n"),
      1,
    );
    assert.deepEqual(
      new Uint8Array(
        await (await runtime.env.PRIVATE_FILES.get(key)).arrayBuffer(),
      ),
      raw,
    );
    const next = await acquireRun(
      runtime.env.DB,
      "greenhouse:stripe",
      "2026-09-12",
    );
    await capturePage(runtime.env, next, raw, "2026-09-11T12:00:00Z");
    assert.equal((await runtime.advance(next.id)).state, "succeeded");
    assert.equal(
      await runtime.env.DB.prepare(
        "SELECT unchanged_count FROM ingestion_runs WHERE id=?",
      )
        .bind(next.id)
        .first("unchanged_count"),
      1,
    );
    assert.equal(
      await runtime.env.DB.prepare("SELECT count(*) n FROM job_versions").first(
        "n",
      ),
      1,
    );
  } finally {
    await runtime?.dispose();
    const resolved = await realpath(root);
    assert.equal(path.dirname(resolved), temporaryBase);
    assert.ok(path.basename(resolved).startsWith("job-board-shadow-test-"));
    await rm(resolved, { recursive: true, force: true });
  }
});
