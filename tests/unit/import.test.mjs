import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { sourceFixture } from "../fixtures/source.mjs";
import { importRecords } from "../../scripts/migration/import-d1.ts";
import { mapRecords, legacyId } from "../../scripts/migration/map-records.ts";
import { recordHash } from "../../scripts/migration/validate-export.ts";
import fieldMap from "../../scripts/migration/field-map.json" with { type: "json" };
function database() {
  const sqlite = new DatabaseSync(":memory:");
  for (const name of [
    "0001_foundation.sql",
    "0002_migration.sql",
    "0004_migration_history.sql",
  ])
    sqlite.exec(
      readFileSync(
        new URL("../../packages/data/migrations/" + name, import.meta.url),
        "utf8",
      ),
    );
  return {
    sqlite,
    prepare(sql) {
      const stmt = sqlite.prepare(sql);
      let args = [];
      const wrapper = {
        sql,
        bind(...values) {
          args = values;
          return wrapper;
        },
        async first() {
          return stmt.get(...args) ?? null;
        },
        async all() {
          return { results: stmt.all(...args) };
        },
        async run() {
          return stmt.run(...args);
        },
      };
      return wrapper;
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const stmt of statements) results.push(await stmt.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
const attachments = (source) => ({
  sourceHash: recordHash(source),
  createdAt: "2026-09-11T10:02:00Z",
  scanner: "not-configured",
  attachments: [],
});
test("the checked field-ID contract blocks renamed or colliding mapped fields before writes", async () => {
  const source = sourceFixture(),
    db = database();
  for (const table of source.tables) {
    const contract = fieldMap.tables.find(
      (expected) => expected.name === table.name,
    );
    for (const row of table.records)
      row.fields = Object.fromEntries(
        Object.entries(row.fields).map(([key, value]) => [
          contract.fields.find(
            (expected) =>
              expected.name ===
              table.fields.find((field) => field.id === key)?.name,
          )?.sourceFieldId ?? key,
          value,
        ]),
      );
    table.id = contract.sourceTableId;
    table.fields = contract.fields.map((field) => ({
      id: field.sourceFieldId,
      name: field.name,
      type: field.type,
    }));
  }
  assert.equal(
    (await importRecords(db, source, attachments(source))).state,
    "rehearsed",
  );
  source.tables[1].fields.find((field) => field.name === "Full Name").name =
    "Display Name";
  const result = await importRecords(db, source, attachments(source));
  assert.equal(result.state, "blocked");
  assert.ok(
    result.issues.some((issue) => issue.code === "SOURCE_SCHEMA_CHANGED"),
  );
  assert.equal(
    db.sqlite.prepare("SELECT name FROM candidate_profiles").get().name,
    "Candidate A",
  );
  db.sqlite.close();
});
test("source snapshot history retains earlier retained-only values across imports", async () => {
  const db = database(),
    source = sourceFixture();
  await importRecords(db, source, attachments(source));
  source.tables[0].records[0].fields.skills =
    "Changed retained-only source data";
  await importRecords(db, source, attachments(source));
  const rows = db.sqlite
    .prepare(
      "SELECT fields_json FROM legacy_snapshot_versions WHERE source_id=?",
    )
    .all("user-a");
  assert.equal(rows.length, 2);
  assert.ok(
    rows.some(
      (row) => JSON.parse(row.fields_json).skills === "Extra source field",
    ),
  );
  assert.throws(() =>
    db.sqlite.exec("UPDATE legacy_snapshot_versions SET fields_json='{}'"),
  );
  db.sqlite.close();
});
test("replaying an older imported archive after a newer version is blocked before writes", async () => {
  const db = database(),
    first = sourceFixture(),
    second = structuredClone(first);
  await importRecords(db, first, attachments(first));
  second.tables[0].records[0].fields.skills = "Newer source evidence";
  await importRecords(db, second, attachments(second));
  const before = db.sqlite
    .prepare("SELECT * FROM legacy_record_snapshots")
    .all();
  const replay = await importRecords(db, first, attachments(first));
  assert.equal(replay.state, "blocked");
  assert.equal(replay.changed, 0);
  assert.ok(
    replay.issues.some((issue) => issue.code === "STALE_EXPORT_REPLAY"),
  );
  assert.deepEqual(
    db.sqlite.prepare("SELECT * FROM legacy_record_snapshots").all(),
    before,
  );
  db.sqlite.close();
});
test("removed authentication roster identities require disposition and lose claim eligibility", async () => {
  const db = database(),
    source = sourceFixture();
  await importRecords(db, source, attachments(source));
  db.sqlite.exec(
    "UPDATE legacy_auth_roster SET verified_link=1 WHERE source_auth_id='auth-b'",
  );
  source.authRoster.users = source.authRoster.users.filter(
    (user) => user.id !== "auth-b",
  );
  source.authRoster.total = 1;
  const result = await importRecords(db, source, attachments(source));
  assert.equal(result.state, "blocked");
  assert.ok(
    result.issues.some((issue) => issue.code === "AUTH_SOURCE_DELETED"),
  );
  const prior = db.sqlite
    .prepare(
      "SELECT source_active,verified_link FROM legacy_auth_roster WHERE source_auth_id=?",
    )
    .get("auth-b");
  assert.equal(prior.source_active, 0);
  assert.equal(prior.verified_link, 0);
  db.sqlite.close();
});
test("an edit arriving between drift check and import batch wins without corrupting bookkeeping", async () => {
  const db = database(),
    source = sourceFixture();
  await importRecords(db, source, attachments(source));
  source.tables[3].records[0].fields.notes = "Changed at source";
  const runBatch = db.batch.bind(db);
  let injected = false;
  db.batch = async (statements) => {
    if (
      !injected &&
      statements.some((s) => s.sql.startsWith("UPDATE saved_jobs SET"))
    ) {
      injected = true;
      db.sqlite
        .prepare("UPDATE saved_jobs SET notes=?,revision=revision+1")
        .run("Concurrent user edit");
    }
    return runBatch(statements);
  };
  const result = await importRecords(db, source, attachments(source));
  assert.equal(injected, true);
  assert.equal(result.state, "blocked");
  assert.equal(
    db.sqlite.prepare("SELECT notes FROM saved_jobs").get().notes,
    "Concurrent user edit",
  );
  assert.equal(
    db.sqlite.prepare("SELECT COUNT(*) AS n FROM import_write_guards").get().n,
    0,
  );
  db.sqlite.close();
});
test("imports rerun without duplicates, false account activation or content drift", async () => {
  const db = database(),
    source = sourceFixture();
  const first = await importRecords(db, source, attachments(source));
  const before = db.sqlite.prepare("SELECT * FROM saved_jobs").all();
  const second = await importRecords(db, source, attachments(source));
  assert.equal(first.state, "rehearsed");
  assert.equal(second.changed, 0);
  assert.deepEqual(db.sqlite.prepare("SELECT * FROM saved_jobs").all(), before);
  assert.equal(
    db.sqlite.prepare("SELECT COUNT(*) AS n FROM legacy_id_map").get().n,
    6,
  );
  assert.equal(
    db.sqlite.prepare("SELECT COUNT(*) AS n FROM auth_identities").get().n,
    0,
  );
  assert.equal(
    db.sqlite
      .prepare(
        "SELECT source_status FROM legacy_auth_roster WHERE source_auth_id=?",
      )
      .get("auth-b").source_status,
    "NOT_INVITED",
  );
  assert.equal(
    db.sqlite.prepare("SELECT COUNT(*) AS n FROM active_profiles").get().n,
    0,
  );
  db.sqlite.close();
});
test("unmapped fields and legacy draft approval are retained without invented provenance", async () => {
  const db = database(),
    source = sourceFixture();
  await importRecords(db, source, attachments(source));
  const retained = JSON.parse(
    db.sqlite
      .prepare(
        "SELECT fields_json FROM legacy_record_snapshots WHERE source_id=?",
      )
      .get("user-a").fields_json,
  );
  assert.equal(retained.skills, "Extra source field");
  const draft = db.sqlite
    .prepare("SELECT status,provenance,profile_id FROM draft_applications")
    .get();
  assert.equal(draft.status, "Approved");
  assert.equal(draft.provenance, "legacy");
  assert.equal(draft.profile_id, null);
  const mapped = mapRecords(source, attachments(source));
  assert.equal(mapped.jobs[0].version.salaryCurrency, null);
  db.sqlite.close();
});
test("new source content adds versions but cannot overwrite target user edits", async () => {
  const db = database(),
    source = sourceFixture();
  await importRecords(db, source, attachments(source));
  source.tables[1].records[0].fields.summary = "New source evidence";
  source.tables[1].records[0].updatedAt = "2026-09-11T12:00:00Z";
  const result = await importRecords(db, source, attachments(source));
  assert.equal(result.state, "rehearsed");
  assert.equal(
    db.sqlite.prepare("SELECT COUNT(*) AS n FROM profile_versions").get().n,
    2,
  );
  db.sqlite
    .prepare("UPDATE saved_jobs SET notes=?,revision=revision+1 WHERE id=?")
    .run("User edit", legacyId("saves", "save-a"));
  const conflict = await importRecords(db, source, attachments(source));
  assert.equal(conflict.state, "blocked");
  assert.ok(conflict.issues.some((i) => i.code === "TARGET_DRIFT"));
  assert.equal(
    db.sqlite.prepare("SELECT notes FROM saved_jobs").get().notes,
    "User edit",
  );
  db.sqlite.close();
});
test("invalid ownership is quarantined before target writes", async () => {
  const db = database(),
    source = sourceFixture();
  source.tables[4].records[0].fields.owner.id = "user-b";
  const result = await importRecords(db, source, attachments(source));
  assert.equal(result.state, "blocked");
  assert.ok(result.issues.some((i) => i.code === "DRAFT_OWNER_MISMATCH"));
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM users").get().n, 0);
  db.sqlite.close();
});
test("missing source records require a reviewed disposition instead of append-only success", async () => {
  const db = database(),
    source = sourceFixture();
  await importRecords(db, source, attachments(source));
  source.tables[4].records = [];
  source.tables[4].recordsCount = 0;
  const result = await importRecords(db, source, attachments(source));
  assert.equal(result.state, "blocked");
  assert.ok(result.issues.some((i) => i.code === "SOURCE_DELETED"));
  assert.equal(
    db.sqlite.prepare("SELECT COUNT(*) AS n FROM draft_applications").get().n,
    1,
  );
  db.sqlite.close();
});
