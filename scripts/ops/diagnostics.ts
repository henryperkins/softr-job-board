import { openLocalInspection } from "./local-inspection.ts";
import { readFile, readdir } from "node:fs/promises";
import { recordHash } from "../migration/validate-export.ts";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Operator diagnostics.
 *
 * Every query below is a fixed statement with no interpolated input, and every
 * projection is a count, a state name or an age. No record content, no user
 * identifier, no token and no provider output is read, so the output is safe to
 * paste into an incident channel.
 *
 * This is deliberately a trusted operator CLI rather than an application
 * endpoint: there is no operator header to forge and no admin route for a normal
 * user to reach.
 *
 * Usage: node scripts/ops/diagnostics.ts <recognized-local-store> [--json]
 */
type Db = {
  prepare: (sql: string) => {
    all: <T>() => Promise<{ results: T[] }>;
    first: <T>() => Promise<T | null>;
  };
};

async function migrationLedgerHashes(directory: string) {
  const result: { name: string; sha256: string }[] = [];
  for (const name of (await readdir(directory))
    .filter((name) => /^\d{4}_[a-z_]+\.sql$/.test(name))
    .sort()) {
    const sql = (await readFile(path.join(directory, name), "utf8")).replace(
      /\r\n/g,
      "\n",
    );
    // Local rehearsal ledgers intentionally use recordHash, so compare like
    // with like rather than the raw-file release-manifest digest.
    result.push({ name, sha256: recordHash(sql) });
  }
  return result;
}

const hoursSince = (value: string | null, now: number) =>
  value ? Math.round(((now - Date.parse(value)) / 3_600_000) * 10) / 10 : null;

export async function collectDiagnostics(
  db: Db,
  now = Date.now(),
  expectedMigrations: { name: string; sha256: string }[] = [],
) {
  const rows = async <T>(sql: string) =>
    (await db.prepare(sql).all<T>()).results;
  const tables = new Set(
    (
      await rows<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table'",
      )
    ).map((row) => row.name),
  );
  const ifTable = async <T>(name: string, sql: string) =>
    tables.has(name) ? rows<T>(sql) : [];

  const sources = await ifTable<{
    source: string;
    last_success_at: string;
    row_count: number;
  }>(
    "source_observations",
    "SELECT source,last_success_at,row_count FROM source_observations",
  );
  const runs = await ifTable<{ source: string; state: string; count: number }>(
    "ingestion_runs",
    "SELECT source,state,COUNT(*) AS count FROM ingestion_runs GROUP BY source,state",
  );
  const outbox = await ifTable<{
    kind: string;
    state: string;
    error_reason:
      "none" | "dispatch_unconfirmed" | "dispatch_lease_exhausted" | "other";
    count: number;
    oldest_available_at: string | null;
    max_attempts: number;
  }>(
    "outbox",
    "SELECT kind,state,CASE WHEN last_error='dispatch_unconfirmed' THEN 'dispatch_unconfirmed' WHEN last_error='dispatch_lease_exhausted' THEN 'dispatch_lease_exhausted' WHEN last_error IS NULL THEN 'none' ELSE 'other' END AS error_reason,COUNT(*) AS count,MIN(available_at) AS oldest_available_at,MAX(attempts) AS max_attempts FROM outbox GROUP BY kind,state,CASE WHEN last_error='dispatch_unconfirmed' THEN 'dispatch_unconfirmed' WHEN last_error='dispatch_lease_exhausted' THEN 'dispatch_lease_exhausted' WHEN last_error IS NULL THEN 'none' ELSE 'other' END",
  );
  const backlog = await ifTable<{
    state: string;
    action: string | null;
    count: number;
  }>(
    "ingestion_backlog",
    "SELECT state,action,COUNT(*) AS count FROM ingestion_backlog GROUP BY state,action",
  );
  const generation = await ifTable<{ state: string; count: number }>(
    "generation_requests",
    "SELECT state,COUNT(*) AS count FROM generation_requests GROUP BY state",
  );
  const attempts = await ifTable<{
    state: string;
    count: number;
    failure_code: string | null;
  }>(
    "generation_attempts",
    "SELECT state,failure_code,COUNT(*) AS count FROM generation_attempts GROUP BY state,failure_code",
  );
  const usage = tables.has("generation_attempts")
    ? await db
        .prepare(
          "SELECT COUNT(usage_json) AS callsWithUsage,COALESCE(SUM(COALESCE(json_extract(usage_json,'$.input_tokens'),json_extract(usage_json,'$.inputTokens'),0)),0) AS inputTokens,COALESCE(SUM(COALESCE(json_extract(usage_json,'$.output_tokens'),json_extract(usage_json,'$.outputTokens'),0)),0) AS outputTokens FROM generation_attempts",
        )
        .first<{
          callsWithUsage: number;
          inputTokens: number;
          outputTokens: number;
        }>()
    : null;
  const manifests = await ifTable<{ state: string; count: number }>(
    "import_manifests",
    "SELECT state,COUNT(*) AS count FROM import_manifests GROUP BY state",
  );
  const attachments = await ifTable<{
    status: string;
    scan_status: string;
    count: number;
  }>(
    "attachments",
    "SELECT status,scan_status,COUNT(*) AS count FROM attachments GROUP BY status,scan_status",
  );
  const reviews = tables.has("ingestion_reviews")
    ? await db
        .prepare("SELECT COUNT(*) AS count FROM ingestion_reviews")
        .first<{ count: number }>()
    : null;
  const grants = tables.has("oauthConsent")
    ? await db
        .prepare(
          "SELECT (SELECT COUNT(*) FROM oauthConsent) AS consents,(SELECT COUNT(*) FROM oauthClient) AS clients,(SELECT COUNT(*) FROM oauthAccessToken) AS accessTokens,(SELECT COUNT(*) FROM oauthRefreshToken) AS refreshTokens",
        )
        .first<{
          consents: number;
          clients: number;
          accessTokens: number;
          refreshTokens: number;
        }>()
    : null;
  const applied = await ifTable<{ name: string; checksum: string }>(
    "local_migrations",
    "SELECT name,checksum FROM local_migrations ORDER BY name",
  );
  const expected = new Map(expectedMigrations.map((m) => [m.name, m.sha256]));
  const actual = new Map(applied.map((m) => [m.name, m.checksum]));
  const migrationDrift = {
    missing: expectedMigrations
      .filter((m) => !actual.has(m.name))
      .map((m) => m.name),
    mismatched: expectedMigrations
      .filter((m) => actual.has(m.name) && actual.get(m.name) !== m.sha256)
      .map((m) => m.name),
    unexpected: applied.filter((m) => !expected.has(m.name)).map((m) => m.name),
  };

  return {
    capturedAt: new Date(now).toISOString(),
    scope:
      "local store counts and ages only; no record content, identifiers, tokens or provider output",
    sources: sources.map((s) => ({
      source: s.source,
      lastSuccessAgeHours: hoursSince(s.last_success_at, now),
      rowCount: s.row_count,
    })),
    ingestionRuns: runs,
    ingestionBacklog: backlog,
    // A growing backlog age is the signal that dispatch has stalled.
    outbox: outbox.map((o) => ({
      state: o.state,
      kind: o.kind,
      errorReason: o.error_reason,
      count: o.count,
      oldestAvailableAgeHours: hoursSince(o.oldest_available_at, now),
      maxAttempts: o.max_attempts,
    })),
    generationRequests: generation,
    // 'ambiguous' means a provider call may have been billed without a usable
    // result. It is reported separately because it needs a human decision.
    generationAttempts: attempts,
    generationUsage: usage ?? {
      callsWithUsage: 0,
      inputTokens: 0,
      outputTokens: 0,
    },
    migrationDrift,
    migrationManifests: manifests,
    attachments,
    ingestionReviews: reviews?.count ?? 0,
    oauthGrants: grants ?? {
      consents: 0,
      clients: 0,
      accessTokens: 0,
      refreshTokens: 0,
    },
    // Deliberately absent: rejected-authorization counts. Recording one row per
    // refused bearer token would let an unauthenticated caller write to D1 at
    // will. Those are emitted as structured logs (see workers/app/src/
    // observability.ts) and belong on the Workers observability side.
    notes: [
      "Alert thresholds are a deployment choice. Nothing here asserts an SLO.",
      "Rejected authorization is logged, not stored; count it from Worker logs.",
    ],
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const directory = process.argv[2];
  if (!directory)
    throw new Error(
      "Usage: node scripts/ops/diagnostics.ts <recognized-local-store> [--json]",
    );
  const runtime = await openLocalInspection(directory);
  try {
    const migrations = await migrationLedgerHashes(
      fileURLToPath(
        new URL("../../packages/data/migrations/", import.meta.url),
      ),
    );
    const report = await collectDiagnostics(
      runtime.db as unknown as Db,
      Date.now(),
      migrations,
    );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await runtime.dispose();
  }
}
