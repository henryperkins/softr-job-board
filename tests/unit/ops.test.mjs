import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  verify,
  checkOrdering,
  migrationHashes,
} from "../../scripts/ops/release-evidence.ts";
import { collectDiagnostics } from "../../scripts/ops/diagnostics.ts";
import { openLocalInspection } from "../../scripts/ops/local-inspection.ts";
import { recordHash } from "../../scripts/migration/validate-export.ts";

const MIGRATIONS = fileURLToPath(
  new URL("../../packages/data/migrations/", import.meta.url),
);
const RELEASE_EVIDENCE_CLI = fileURLToPath(
  new URL("../../scripts/ops/release-evidence.ts", import.meta.url),
);
const DIAGNOSTICS_CLI = fileURLToPath(
  new URL("../../scripts/ops/diagnostics.ts", import.meta.url),
);

test("release evidence CLI fails for missing or invalid manifests", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "release-evidence-cli-"),
  );
  const invalidManifest = path.join(directory, "invalid.json");
  await writeFile(invalidManifest, "{not-json", "utf8");

  try {
    const cases = [
      { name: "no manifest argument", args: [] },
      {
        name: "missing manifest file",
        args: [path.join(directory, "missing.json")],
      },
      { name: "invalid manifest JSON", args: [invalidManifest] },
    ];

    for (const scenario of cases) {
      const result = spawnSync(
        process.execPath,
        [RELEASE_EVIDENCE_CLI, ...scenario.args],
        { encoding: "utf8" },
      );
      assert.notEqual(
        result.status,
        0,
        `${scenario.name} must fail closed; stdout=${result.stdout}; stderr=${result.stderr}`,
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("diagnostics CLI executes and fails when its store argument is missing", () => {
  const result = spawnSync(process.execPath, [DIAGNOSTICS_CLI], {
    encoding: "utf8",
  });
  assert.notEqual(
    result.status,
    0,
    `diagnostics CLI must fail closed; stdout=${result.stdout}; stderr=${result.stderr}`,
  );
  assert.match(result.stderr, /recognized-local-store/);
});

async function fileSnapshot(directory) {
  const result = {};
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(file);
      else
        result[path.relative(directory, file)] = createHash("sha256")
          .update(await readFile(file))
          .digest("hex");
    }
  }
  await visit(directory);
  return result;
}

async function createPendingWalStore(directory) {
  const state = path.join(
    directory,
    "state",
    "d1",
    "miniflare-D1DatabaseObject",
  );
  await mkdir(state, { recursive: true });
  await writeFile(
    path.join(directory, "rehearsal.json"),
    JSON.stringify({ kind: "softr-job-board-local-rehearsal", version: 1 }),
  );
  await writeFile(path.join(directory, "wrangler.local.json"), "{}");
  const databasePath = path.join(state, "synthetic.sqlite");
  const migrations = [];
  for (const name of (await readdir(MIGRATIONS))
    .filter((name) => /^000[1-6]_[a-z_]+\.sql$/.test(name))
    .sort()) {
    const sql = (await readFile(path.join(MIGRATIONS, name), "utf8")).replace(
      /\r\n/g,
      "\n",
    );
    migrations.push({ name, sql, checksum: recordHash(sql) });
  }
  const fixture = path.join(directory, "fixture-migrations.json");
  await writeFile(fixture, JSON.stringify(migrations));

  // Preserve a valid committed WAL snapshot, then close every connection and
  // restore that snapshot after the child process exits. This avoids retaining
  // any SQLite shared-memory handle in the test process on Windows. The source
  // has no live writer/reader and its observation exists only through the WAL.
  const savedMain = path.join(directory, "saved-main");
  const savedWal = path.join(directory, "saved-wal");
  const savedShm = path.join(directory, "saved-shm");
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
        import { copyFileSync, readFileSync } from "node:fs";
        import { DatabaseSync } from "node:sqlite";
        const [databasePath, fixture, savedMain, savedWal, savedShm] = process.argv.slice(1);
        const database = new DatabaseSync(databasePath);
        database.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE local_migrations(name TEXT PRIMARY KEY,checksum TEXT NOT NULL);");
        for (const migration of JSON.parse(readFileSync(fixture, "utf8"))) {
          database.exec(migration.sql);
          database.prepare("INSERT INTO local_migrations(name,checksum) VALUES(?,?)").run(migration.name, migration.checksum);
        }
        database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
        database.exec("INSERT INTO ingestion_runs(id,source,chicago_date,state,created_at,updated_at) VALUES('wal-run','fixture','2026-09-11','succeeded','2026-09-11T12:00:00.000Z','2026-09-11T12:00:00.000Z'); INSERT INTO source_observations(source,last_success_at,run_id,row_count) VALUES('wal-only-source','2026-09-11T12:00:00.000Z','wal-run',7);");
        copyFileSync(databasePath, savedMain);
        copyFileSync(databasePath + "-wal", savedWal);
        copyFileSync(databasePath + "-shm", savedShm);
        database.close();
      `,
      databasePath,
      fixture,
      savedMain,
      savedWal,
      savedShm,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  await rm(databasePath + "-wal", { force: true });
  await rm(databasePath + "-shm", { force: true });
  await copyFile(savedMain, databasePath);
  await copyFile(savedWal, databasePath + "-wal");
  await copyFile(savedShm, databasePath + "-shm");
  await rm(savedMain);
  await rm(savedWal);
  await rm(savedShm);
  await rm(fixture);
  return databasePath;
}

test(
  "diagnostics inspects an existing pending store without changing it",
  { timeout: 60_000 },
  async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "diagnostics-store-"));
    const directory = path.join(parent, "recognized");
    try {
      await createPendingWalStore(directory);
      const before = await fileSnapshot(directory);
      const result = spawnSync(process.execPath, [DIAGNOSTICS_CLI, directory], {
        encoding: "utf8",
        timeout: 30_000,
      });
      assert.equal(result.status, 0, result.stderr);
      const report = JSON.parse(result.stdout);
      assert.deepEqual(report.migrationDrift.missing, ["0007_mcp.sql"]);
      assert.deepEqual(report.migrationDrift.mismatched, []);
      assert.deepEqual(report.migrationDrift.unexpected, []);
      assert.equal(report.sources[0].source, "wal-only-source");
      assert.equal(report.sources[0].rowCount, 7);
      assert.deepEqual(await fileSnapshot(directory), before);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  },
);

test("diagnostics never silently omits a commit checkpointed between copies", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "diagnostics-race-"));
  const state = path.join(
    directory,
    "state",
    "d1",
    "miniflare-D1DatabaseObject",
  );
  await mkdir(state, { recursive: true });
  await writeFile(
    path.join(directory, "rehearsal.json"),
    JSON.stringify({ kind: "softr-job-board-local-rehearsal", version: 1 }),
  );
  await writeFile(path.join(directory, "wrangler.local.json"), "{}");
  const databasePath = path.join(state, "synthetic.sqlite");
  const source = new DatabaseSync(databasePath);
  let runtime;
  try {
    source.exec(
      "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE local_migrations(name TEXT PRIMARY KEY,checksum TEXT NOT NULL); CREATE TABLE observations(id INTEGER PRIMARY KEY); PRAGMA wal_checkpoint(TRUNCATE); INSERT INTO observations DEFAULT VALUES;",
    );
    assert.equal(
      source.prepare("SELECT COUNT(*) AS count FROM observations").get().count,
      1,
    );
    let checkpointBetweenCopies = false;
    runtime = await openLocalInspection(directory, {
      async copyFile(from, to) {
        await copyFile(from, to);
        if (!checkpointBetweenCopies && from === databasePath) {
          checkpointBetweenCopies = true;
          source.exec("PRAGMA wal_checkpoint(TRUNCATE)");
        }
      },
    });
    const inspected = await runtime.db
      .prepare("SELECT COUNT(*) AS count FROM observations")
      .first();
    assert.equal(checkpointBetweenCopies, true);
    assert.equal(inspected.count, 1);
  } finally {
    await runtime?.dispose();
    source.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("diagnostics never creates a missing store", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "diagnostics-missing-"));
  const missing = path.join(parent, "does-not-exist");
  try {
    const result = spawnSync(process.execPath, [DIAGNOSTICS_CLI, missing], {
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    await assert.rejects(readFile(path.join(missing, "rehearsal.json")));
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

async function completeEvidence() {
  return {
    release: {
      environment: "staging",
      gitSha: "a".repeat(40),
      treeClean: true,
      preparedAt: "2026-09-11T16:00:00.000Z",
      preparedBy: "release-operator",
    },
    localChecks: Object.fromEntries(
      [
        "lint",
        "typecheck",
        "unit",
        "integration",
        "jobs",
        "browser",
        "dryBuilds",
      ].map((k) => [k, { passed: true, total: 1, command: `pnpm ${k}` }]),
    ),
    deployed: {
      appWorker: {
        name: "job-board-app-staging",
        versionId: "11111111-2222-3333-4444-555555555555",
        deployedAt: "2026-09-11T16:05:00.000Z",
      },
      backgroundWorker: {
        name: "job-board-jobs-staging",
        versionId: "66666666-7777-8888-9999-000000000000",
        deployedAt: "2026-09-11T16:05:30.000Z",
      },
      d1DatabaseId: "9f6b1f0e-0000-4a00-9a00-abcdefabcdef",
      r2Buckets: ["job-board-private-staging"],
      emailBinding: {
        name: "EMAIL",
        allowedSenderAddresses: ["no-reply@auth.lakefrontdev.com"],
        mailFrom: "no-reply@auth.lakefrontdev.com",
      },
      d1Bookmark: "0000000a-0000000b-00004fa2-abcdef",
      restoreRehearsedAt: "2026-09-11T16:20:00.000Z",
      deliveryVerifiedAt: "2026-09-11T16:25:00.000Z",
      isolationVerifiedAt: "2026-09-11T16:30:00.000Z",
    },
    migrations: await migrationHashes(MIGRATIONS),
    releaseFlags: {
      writesEnabled: true,
      generationEnabled: false,
      mcpEnabled: false,
      mcpWritesEnabled: false,
      mcpGenerationEnabled: false,
      mcpReviewEnabled: false,
      mailMode: "cloudflare",
    },
    sourceCutover: {
      finalExportHash: "b".repeat(64),
      attachmentManifestHash: "c".repeat(64),
      recordCount: 349,
      writerFrozenAt: "2026-09-11T15:00:00.000Z",
      lastAcceptedSourceWriteAt: "2026-09-11T14:59:00.000Z",
      firstAcceptedTargetWriteAt: "2026-09-11T15:10:00.000Z",
    },
    routing: {
      apexBefore: "lakefrontdev-origin-proxy",
      apexAfter: "job-board-app-staging",
      wwwBefore: "lakefrontdev-origin-proxy",
      wwwAfter: "job-board-app-staging",
      unrelatedRecordsPreserved: true,
    },
  };
}

test("complete release evidence passes", async () => {
  const result = await verify(await completeEvidence(), MIGRATIONS);
  assert.deepEqual(result.problems, []);
  assert.equal(result.ok, true);
});

test("missing deployed evidence fails closed and local results cannot replace it", async () => {
  const evidence = await completeEvidence();
  delete evidence.deployed.appWorker.versionId;
  const result = await verify(evidence, MIGRATIONS);
  assert.equal(result.ok, false);
  assert.ok(
    result.problems.some((p) => p.includes("deployed.appWorker.versionId")),
    result.problems.join("; "),
  );
});

test("placeholder and unprovisioned identifiers are rejected", async () => {
  for (const value of [
    "",
    "TODO",
    "UNPROVISIONED_STAGING",
    "REPLACE_WITH_OBSERVED_ROUTE",
    "  ",
    "n/a",
  ]) {
    const evidence = await completeEvidence();
    evidence.deployed.d1DatabaseId = value;
    const result = await verify(evidence, MIGRATIONS);
    assert.equal(result.ok, false, `expected ${JSON.stringify(value)} to fail`);
  }
});

test("a placeholder origin in routing is rejected", async () => {
  const evidence = await completeEvidence();
  evidence.routing.apexAfter = "production.invalid";
  const result = await verify(evidence, MIGRATIONS);
  assert.equal(result.ok, false);
});

test("a failing local check cannot be recorded as passing", async () => {
  const evidence = await completeEvidence();
  evidence.localChecks.browser.passed = false;
  const result = await verify(evidence, MIGRATIONS);
  assert.equal(result.ok, false);
});

test("a migration hash that does not match this checkout fails", async () => {
  const evidence = await completeEvidence();
  evidence.migrations[0].sha256 = "d".repeat(64);
  const result = await verify(evidence, MIGRATIONS);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes("does not match")));
});

test("an unrecorded migration fails rather than being ignored", async () => {
  const evidence = await completeEvidence();
  evidence.migrations.pop();
  const result = await verify(evidence, MIGRATIONS);
  assert.equal(result.ok, false);
  assert.ok(
    result.problems.some((p) => p.includes("missing from the manifest")),
  );
});

test("recorded migration hashes are the real file hashes", async () => {
  const hashes = await migrationHashes(MIGRATIONS);
  const names = (await readdir(MIGRATIONS))
    .filter((n) => n.endsWith(".sql"))
    .sort();
  assert.equal(hashes.length, names.length);
  const sql = (await readFile(path.join(MIGRATIONS, names[0]), "utf8")).replace(
    /\r\n/g,
    "\n",
  );
  assert.equal(
    hashes[0].sha256,
    createHash("sha256").update(sql).digest("hex"),
  );
});

test("an overlapping write window is refused", async () => {
  const evidence = await completeEvidence();
  evidence.sourceCutover.lastAcceptedSourceWriteAt = "2026-09-11T15:30:00.000Z";
  const problems = checkOrdering(evidence);
  assert.ok(problems.some((p) => p.includes("after the writer freeze")));

  const early = await completeEvidence();
  early.sourceCutover.firstAcceptedTargetWriteAt = "2026-09-11T14:00:00.000Z";
  assert.ok(
    checkOrdering(early).some((p) =>
      p.includes("before the source was frozen"),
    ),
  );
});

test("diagnostics report counts and ages without record content", async () => {
  const now = Date.parse("2026-09-11T16:00:00.000Z");
  const tables = {
    source_observations: [
      {
        source: "greenhouse",
        last_success_at: "2026-09-11T14:00:00.000Z",
        row_count: 1376,
      },
    ],
    ingestion_runs: [{ source: "greenhouse", state: "succeeded", count: 2 }],
    outbox: [
      {
        kind: "ingest-source",
        state: "pending",
        error_reason: "none",
        count: 3,
        oldest_available_at: "2026-09-11T13:00:00.000Z",
        max_attempts: 2,
      },
    ],
    generation_requests: [{ state: "queued", count: 1 }],
    generation_attempts: [{ state: "ambiguous", failure_code: null, count: 1 }],
    ingestion_backlog: [{ state: "pending", action: "upsert", count: 4 }],
    import_manifests: [{ state: "applied", count: 1 }],
    attachments: [{ status: "available", scan_status: "pending", count: 26 }],
  };
  const db = {
    prepare(sql) {
      return {
        all: async () => {
          if (sql.includes("sqlite_master"))
            return {
              results: [
                ...Object.keys(tables),
                "ingestion_reviews",
                "oauthConsent",
              ].map((name) => ({ name })),
            };
          const table = Object.keys(tables).find((t) =>
            sql.includes(`FROM ${t}`),
          );
          return { results: tables[table] ?? [] };
        },
        first: async () =>
          sql.includes("oauthConsent")
            ? { consents: 1, clients: 1, accessTokens: 1, refreshTokens: 1 }
            : sql.includes("usage_json")
              ? { callsWithUsage: 1, inputTokens: 10, outputTokens: 5 }
              : { count: 0 },
      };
    },
  };
  const report = await collectDiagnostics(db, now);
  assert.equal(report.sources[0].lastSuccessAgeHours, 2);
  assert.equal(report.outbox[0].oldestAvailableAgeHours, 3);
  assert.equal(report.generationAttempts[0].state, "ambiguous");
  assert.equal(report.ingestionBacklog[0].count, 4);
  assert.equal(report.generationUsage.inputTokens, 10);
  assert.equal(report.oauthGrants.accessTokens, 1);

  // Nothing in the report may carry a record value, an identifier or a secret.
  const serialized = JSON.stringify(report);
  for (const forbidden of ["token", "email", "cover_letter", "password"]) {
    assert.ok(
      !new RegExp(`"[^"]*${forbidden}[^"]*"\\s*:\\s*"`, "i").test(
        serialized.replace(/"(accessTokens|refreshTokens)":/g, '"x":'),
      ),
      `report should not contain a ${forbidden} value`,
    );
  }
});

test("diagnostics allowlists dispatch reasons and redacts every other error", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE outbox(
      kind TEXT NOT NULL,
      state TEXT NOT NULL,
      last_error TEXT,
      attempts INTEGER NOT NULL,
      available_at TEXT NOT NULL
    );
    INSERT INTO outbox VALUES
      ('ingest-source','pending','dispatch_unconfirmed',1,'2026-09-11T13:00:00.000Z'),
      ('ingest-source','pending','dispatch_lease_exhausted',2,'2026-09-11T14:00:00.000Z'),
      ('ingest-source','pending',NULL,0,'2026-09-11T15:00:00.000Z'),
      ('ingest-source','pending','provider-secret-must-not-escape',3,'2026-09-11T15:30:00.000Z');
  `);
  try {
    const db = {
      prepare(sql) {
        const statement = sqlite.prepare(sql);
        return {
          all: async () => ({ results: statement.all() }),
          first: async () => statement.get() ?? null,
        };
      },
    };
    const report = await collectDiagnostics(
      db,
      Date.parse("2026-09-11T16:00:00.000Z"),
    );
    assert.deepEqual(
      new Set(report.outbox.map((row) => row.errorReason)),
      new Set([
        "dispatch_unconfirmed",
        "dispatch_lease_exhausted",
        "none",
        "other",
      ]),
    );
    assert.doesNotMatch(
      JSON.stringify(report),
      /provider-secret-must-not-escape/,
    );
  } finally {
    sqlite.close();
  }
});
