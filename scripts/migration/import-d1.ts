import {
  mapRecords,
  legacyId,
  type MappedRecord,
  type SqlValue,
} from "./map-records.ts";
import {
  recordHash,
  type SourceExport,
  type Issue,
} from "./validate-export.ts";
import type { Manifest } from "./copy-attachments.ts";
import { readTarget, sourceKey } from "./read-target.ts";
export interface Statement {
  bind(...values: SqlValue[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
export interface MigrationDatabase {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<unknown[]>;
}
const tables = new Set([
  "users",
  "candidate_profiles",
  "jobs",
  "saved_jobs",
  "draft_applications",
  "attachments",
]);
const versioned = new Set([
  "candidate_profiles",
  "jobs",
  "saved_jobs",
  "draft_applications",
]);
const statement = (
  db: MigrationDatabase,
  sql: string,
  values: SqlValue[] = [],
) => db.prepare(sql).bind(...values);
function insert(
  db: MigrationDatabase,
  table: string,
  values: Record<string, SqlValue>,
): Statement {
  const keys = Object.keys(values);
  if (![table, ...keys].every((key) => /^[a-z_][a-z0-9_]*$/.test(key)))
    throw new Error("Unsafe import identifier.");
  return statement(
    db,
    "INSERT INTO " +
      table +
      " (" +
      keys.join(",") +
      ") VALUES (" +
      keys.map(() => "?").join(",") +
      ")",
    Object.values(values),
  );
}
function selectCore(row: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map((key) => [key, row[key] ?? null]));
}
function storedCore(record: MappedRecord, row: Record<string, unknown>) {
  return selectCore(row, [
    ...Object.keys(record.core),
    "created_at",
    ...(record.table !== "attachments" ? ["updated_at"] : []),
    ...(versioned.has(record.table) ? ["revision"] : []),
  ]);
}
function historyWrites(
  db: MigrationDatabase,
  record: MappedRecord,
  manifestId: string,
  targetHash: string,
  capturedAt: string,
) {
  return [
    statement(
      db,
      "INSERT INTO legacy_snapshot_versions (source_system,source_table,source_id,source_hash,fields_json,source_created_at,source_updated_at,captured_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
      [
        "softr",
        record.sourceTable,
        record.sourceId,
        record.sourceHash,
        JSON.stringify(record.fields),
        record.sourceCreatedAt,
        record.sourceUpdatedAt,
        capturedAt,
      ],
    ),
    statement(
      db,
      "INSERT INTO import_record_versions (manifest_id,source_system,source_table,source_id,source_hash,target_table,target_id,target_hash) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
      [
        manifestId,
        "softr",
        record.sourceTable,
        record.sourceId,
        record.sourceHash,
        record.table,
        record.id,
        targetHash,
      ],
    ),
  ];
}
export async function importRecords(
  db: MigrationDatabase,
  source: SourceExport,
  files: Manifest,
) {
  const mapped = mapRecords(source, files);
  const issues: Issue[] = [...mapped.issues];
  if (issues.length)
    return {
      state: "blocked",
      changed: 0,
      unchanged: 0,
      issues,
      releaseReady: false,
    };
  const now = new Date().toISOString();
  const manifestId = "import_" + mapped.sourceHash;
  const records = [
    ...mapped.users,
    ...mapped.profiles,
    ...mapped.jobs,
    ...mapped.savedJobs,
    ...mapped.drafts,
    ...mapped.attachments,
  ];
  const counts = Object.fromEntries(
    source.tables.map((table) => [table.name, table.records.length]),
  );
  const before = await readTarget(db, records);
  const priorMembership = await statement(
    db,
    "SELECT source_table,source_id,source_hash,target_hash FROM import_record_versions WHERE manifest_id=? AND source_system=?",
    [manifestId, "softr"],
  ).all();
  for (const member of priorMembership.results) {
    const current = before.snapshots.get(
      sourceKey(member.source_table, member.source_id),
    );
    if (
      current &&
      (current.source_hash !== member.source_hash ||
        current.target_hash !== member.target_hash ||
        current.present_in_source !== 1)
    ) {
      issues.push({
        code: "STALE_EXPORT_REPLAY",
        table: String(member.source_table),
        recordId: String(member.source_id),
      });
    }
  }
  // A completed content snapshot cannot be reused as an implicit rollback. A
  // partially completed snapshot can still resume records it has never written.
  if (issues.length)
    return {
      state: "blocked",
      manifestId,
      changed: 0,
      unchanged: 0,
      issues,
      releaseReady: false,
    };
  await statement(
    db,
    "INSERT INTO import_manifests (id,source_system,source_hash,schema_version,state,counts_json,created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(source_system,source_hash) DO NOTHING",
    [
      manifestId,
      "softr",
      mapped.sourceHash,
      "1",
      "importing",
      JSON.stringify(counts),
      now,
    ],
  ).run();
  await statement(db, "UPDATE import_manifests SET state=? WHERE id=?", [
    "importing",
    manifestId,
  ]).run();
  let changed = 0,
    unchanged = 0;
  const bookkeeping: Statement[] = [];
  for (const record of records) {
    if (!tables.has(record.table)) throw new Error("Unknown import target.");
    const previous = before.snapshots.get(
      sourceKey(record.sourceTable, record.sourceId),
    );
    const existing = before.roots.get(sourceKey(record.table, record.id));
    if ((previous && !existing) || (!previous && existing)) {
      issues.push({
        code: "TARGET_EXISTENCE_CONFLICT",
        table: record.sourceTable,
        recordId: record.sourceId,
      });
      continue;
    }
    if (
      previous &&
      existing &&
      recordHash(storedCore(record, existing)) !== previous.target_hash
    ) {
      issues.push({
        code: "TARGET_DRIFT",
        table: record.sourceTable,
        recordId: record.sourceId,
      });
      continue;
    }
    if (previous && previous.source_hash === record.sourceHash) {
      bookkeeping.push(
        ...historyWrites(
          db,
          record,
          manifestId,
          String(previous.target_hash),
          now,
        ),
        statement(
          db,
          "UPDATE legacy_record_snapshots SET manifest_id=?,present_in_source=1 WHERE source_system=? AND source_table=? AND source_id=?",
          [manifestId, "softr", record.sourceTable, record.sourceId],
        ),
        statement(
          db,
          "UPDATE legacy_id_map SET manifest_id=? WHERE source_system=? AND source_table=? AND source_id=?",
          [manifestId, "softr", record.sourceTable, record.sourceId],
        ),
      );
      if (bookkeeping.length >= 80) await db.batch(bookkeeping.splice(0));
      unchanged++;
      continue;
    }
    const revision = versioned.has(record.table)
      ? Number(existing?.revision ?? 0) + 1
      : null;
    const core: Record<string, SqlValue> = {
      ...record.core,
      created_at:
        typeof existing?.created_at === "string" ? existing.created_at : now,
    };
    if (record.table !== "attachments") core.updated_at = now;
    if (revision !== null) core.revision = revision;
    if (record.table === "draft_applications" && core.status === "Approved")
      core.approved_revision = revision;
    const writes: Statement[] = [];
    const guardId = crypto.randomUUID();
    if (existing) {
      const keys = Object.keys(core).filter((key) => key !== "id");
      const previousCore = storedCore(record, existing);
      const guardKeys = Object.keys(previousCore);
      writes.push(
        statement(
          db,
          "UPDATE " +
            record.table +
            " SET " +
            keys.map((key) => key + "=?").join(",") +
            " WHERE " +
            guardKeys.map((key) => key + " IS ?").join(" AND "),
          [
            ...keys.map((key) => core[key]!),
            ...guardKeys.map((key) => previousCore[key] as SqlValue),
          ],
        ),
      );
      writes.push(
        statement(
          db,
          "INSERT INTO import_write_guards (id,valid) VALUES (?,CASE WHEN changes()=1 THEN 1 ELSE 0 END)",
          [guardId],
        ),
      );
    } else writes.push(insert(db, record.table, core));
    if (record.table === "candidate_profiles")
      writes.push(
        insert(db, "profile_versions", {
          id: record.id + "_v" + revision,
          profile_id: record.id,
          user_id: core.user_id!,
          revision: revision!,
          name: core.name!,
          content_json: core.content_json!,
          created_at: now,
        }),
      );
    if (record.table === "jobs") {
      writes.push(
        insert(db, "job_versions", {
          id: record.id + "_v" + revision,
          job_id: record.id,
          revision: revision!,
          content_json: JSON.stringify(record.version),
          created_at: now,
        }),
      );
      writes.push(
        statement(
          db,
          "INSERT INTO job_sources (id,job_id,source_system,source_key,source_url,first_seen_at,last_seen_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(source_system,source_key) DO UPDATE SET source_url=excluded.source_url,last_seen_at=excluded.last_seen_at",
          [
            legacyId("job_source", record.id),
            record.id,
            "softr-legacy",
            record.sourceTable + ":" + record.sourceId,
            core.source_url!,
            record.sourceCreatedAt,
            typeof record.version?.lastSeenAt === "string"
              ? record.version.lastSeenAt
              : null,
          ],
        ),
      );
    }
    if (record.table === "draft_applications")
      writes.push(
        insert(db, "draft_versions", {
          id: record.id + "_v" + revision,
          draft_id: record.id,
          user_id: core.user_id!,
          revision: revision!,
          cover_letter: core.cover_letter!,
          short_answers: core.short_answers!,
          reviewer_notes: core.reviewer_notes!,
          status: core.status!,
          created_at: now,
        }),
      );
    writes.push(
      statement(
        db,
        "INSERT INTO legacy_id_map (source_system,source_table,source_id,target_table,target_id,manifest_id,source_created_at,source_updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(source_system,source_table,source_id) DO UPDATE SET manifest_id=excluded.manifest_id,source_created_at=excluded.source_created_at,source_updated_at=excluded.source_updated_at",
        [
          "softr",
          record.sourceTable,
          record.sourceId,
          record.table,
          record.id,
          manifestId,
          record.sourceCreatedAt,
          record.sourceUpdatedAt,
        ],
      ),
    );
    writes.push(
      statement(
        db,
        "INSERT INTO legacy_record_snapshots (source_system,source_table,source_id,source_hash,fields_json,target_table,target_id,target_hash,manifest_id,source_created_at,source_updated_at,present_in_source) VALUES (?,?,?,?,?,?,?,?,?,?,?,1) ON CONFLICT(source_system,source_table,source_id) DO UPDATE SET source_hash=excluded.source_hash,fields_json=excluded.fields_json,target_hash=excluded.target_hash,manifest_id=excluded.manifest_id,source_created_at=excluded.source_created_at,source_updated_at=excluded.source_updated_at,present_in_source=1",
        [
          "softr",
          record.sourceTable,
          record.sourceId,
          record.sourceHash,
          JSON.stringify(record.fields),
          record.table,
          record.id,
          recordHash(core),
          manifestId,
          record.sourceCreatedAt,
          record.sourceUpdatedAt,
        ],
      ),
    );
    writes.push(
      ...historyWrites(db, record, manifestId, recordHash(core), now),
      insert(db, "audit_events", {
        id: crypto.randomUUID(),
        actor_user_id: null,
        action: "migration.import",
        entity_type: record.table,
        entity_id: record.id,
        revision,
        created_at: now,
      }),
    );
    if (existing)
      writes.push(
        statement(db, "DELETE FROM import_write_guards WHERE id=?", [guardId]),
      );
    try {
      await db.batch(writes);
      changed++;
    } catch {
      issues.push({
        code: "IMPORT_WRITE_FAILED",
        table: record.sourceTable,
        recordId: record.sourceId,
      });
    }
  }
  if (bookkeeping.length) await db.batch(bookkeeping);
  const currentKeys = new Set(
    records.map((row) => JSON.stringify([row.sourceTable, row.sourceId])),
  );
  const priorRows = await statement(
    db,
    "SELECT source_table,source_id FROM legacy_record_snapshots WHERE source_system=?",
    ["softr"],
  ).all<{ source_table: string; source_id: string }>();
  for (const row of priorRows.results)
    if (!currentKeys.has(JSON.stringify([row.source_table, row.source_id]))) {
      issues.push({
        code: "SOURCE_DELETED",
        table: row.source_table,
        recordId: row.source_id,
      });
      await statement(
        db,
        "UPDATE legacy_record_snapshots SET present_in_source=0 WHERE source_system=? AND source_table=? AND source_id=?",
        ["softr", row.source_table, row.source_id],
      ).run();
    }
  const users = source.tables.find((table) => table.name === "Users")!;
  const emailField = users.fields.find((field) => field.name === "Email")!.id;
  const currentAuthIds = new Set(
    source.authRoster.users.map((user) => user.id),
  );
  const priorAuth = await statement(
    db,
    "SELECT source_auth_id FROM legacy_auth_roster",
  ).all<{ source_auth_id: string }>();
  for (const row of priorAuth.results)
    if (!currentAuthIds.has(row.source_auth_id)) {
      issues.push({
        code: "AUTH_SOURCE_DELETED",
        table: "authRoster",
        recordId: row.source_auth_id,
      });
      await statement(
        db,
        "UPDATE legacy_auth_roster SET source_active=0,verified_link=0 WHERE source_auth_id=?",
        [row.source_auth_id],
      ).run();
    }
  for (const auth of source.authRoster.users) {
    const authHash = recordHash(auth);
    await db.batch([
      statement(
        db,
        "INSERT INTO legacy_snapshot_versions (source_system,source_table,source_id,source_hash,fields_json,captured_at) VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING",
        [
          "softr-auth",
          "auth_roster",
          auth.id,
          authHash,
          JSON.stringify(auth),
          now,
        ],
      ),
      statement(
        db,
        "INSERT INTO import_record_versions (manifest_id,source_system,source_table,source_id,source_hash,target_table,target_id,target_hash) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
        [
          manifestId,
          "softr-auth",
          "auth_roster",
          auth.id,
          authHash,
          "legacy_auth_roster",
          auth.id,
          authHash,
        ],
      ),
    ]);
    const user = users.records.find(
      (row) =>
        String(row.fields[emailField]).trim().toLowerCase() ===
        auth.email.trim().toLowerCase(),
    );
    await statement(
      db,
      "INSERT INTO legacy_auth_roster (source_auth_id,source_user_id,source_email,source_status,source_active,verified_link,metadata_json,manifest_id) VALUES (?,?,?,?,?,0,?,?) ON CONFLICT(source_auth_id) DO UPDATE SET source_user_id=excluded.source_user_id,source_email=excluded.source_email,source_status=excluded.source_status,source_active=excluded.source_active,metadata_json=excluded.metadata_json,manifest_id=excluded.manifest_id,verified_link=CASE WHEN source_email=excluded.source_email AND source_user_id=excluded.source_user_id THEN verified_link ELSE 0 END",
      [
        auth.id,
        user?.id ?? null,
        auth.email,
        auth.status,
        auth.active ? 1 : 0,
        JSON.stringify(auth),
        manifestId,
      ],
    ).run();
  }
  for (const issue of issues)
    await statement(
      db,
      "INSERT INTO import_dispositions (id,manifest_id,source_table,source_id,code,state,created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
      [
        recordHash([manifestId, issue]),
        manifestId,
        issue.table ?? null,
        issue.recordId ?? null,
        issue.code,
        "pending",
        now,
      ],
    ).run();
  const state = issues.length ? "blocked" : "rehearsed";
  await statement(db, "UPDATE import_manifests SET state=? WHERE id=?", [
    state,
    manifestId,
  ]).run();
  return { state, manifestId, changed, unchanged, issues, releaseReady: false };
}
