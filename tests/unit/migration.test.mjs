import test from "node:test";
import assert from "node:assert/strict";
import {
  validateExport,
  recordHash,
} from "../../scripts/migration/validate-export.ts";

function fixture() {
  const record = (id, fields) => ({
    id,
    fields,
    createdAt: "2026-09-11T00:00:00Z",
    updatedAt: "2026-09-11T00:00:00Z",
  });
  const table = (id, name, fields, records) => ({
    id,
    name,
    fields: fields.map(([id, name, type]) => ({ id, name, type })),
    recordsCount: records.length,
    records,
  });
  return {
    schemaVersion: 1,
    exportStartedAt: "2026-09-11T00:00:00Z",
    exportEndedAt: "2026-09-11T00:01:00Z",
    quiescent: false,
    authRoster: {
      users: [
        {
          id: "auth-a",
          email: "a@example.test",
          status: "ACTIVATED",
          active: true,
        },
      ],
      total: 1,
      hasMore: false,
    },
    tables: [
      table(
        "users",
        "Users",
        [["email", "Email", "EMAIL"]],
        [
          record("owner-a", { email: "a@example.test" }),
          record("owner-b", { email: "b@example.test" }),
        ],
      ),
      table(
        "profiles",
        "Candidate Profile",
        [["owner", "Owner", "LINKED_RECORD"]],
        [record("profile-a", { owner: { id: "owner-a" } })],
      ),
      table(
        "jobs",
        "Job Listings",
        [
          ["state", "Job Status", "SELECT"],
          ["url", "Source Job URL", "URL"],
        ],
        [
          record("job-a", {
            state: { id: "open", label: "Open" },
            url: "https://jobs.example.test/requisition/1",
          }),
        ],
      ),
      table(
        "saves",
        "Saved Jobs",
        [
          ["owner", "User", "LINKED_RECORD"],
          ["job", "Job", "LINKED_RECORD"],
          ["status", "Status", "SELECT"],
          ["archive", "Archived", "CHECKBOX"],
        ],
        [
          record("save-a", {
            owner: { id: "owner-a" },
            job: { id: "job-a" },
            status: { label: "Saved" },
            archive: false,
          }),
        ],
      ),
      table(
        "drafts",
        "Draft Applications",
        [
          ["owner", "User", "LINKED_RECORD"],
          ["save", "Saved Job", "LINKED_RECORD"],
          ["status", "Draft Status", "SELECT"],
        ],
        [
          record("draft-a", {
            owner: { id: "owner-a" },
            save: { id: "save-a" },
            status: { label: "Needs Edits" },
          }),
        ],
      ),
    ],
  };
}
test("complete coherent rehearsal is valid but cannot satisfy cutover freeze", () => {
  const result = validateExport(fixture());
  assert.equal(result.valid, true);
  assert.equal(result.cutoverReady, false);
  assert.equal(result.totalRecords, 6);
});
test("a draft linked to another owner is quarantined instead of being attributed by fallback", () => {
  const source = fixture();
  source.tables[4].records[0].fields.owner.id = "owner-b";
  const result = validateExport(source);
  assert.equal(result.valid, false);
  assert.ok(
    result.issues.some(
      (i) => i.code === "DRAFT_OWNER_MISMATCH" && i.recordId === "draft-a",
    ),
  );
});
test("missing profile owner and duplicate saves cannot silently import", () => {
  const source = fixture();
  source.tables[1].records[0].fields.owner = null;
  source.tables[3].records.push({
    ...source.tables[3].records[0],
    id: "save-duplicate",
  });
  source.tables[3].recordsCount = 2;
  const result = validateExport(source);
  assert.ok(result.issues.some((i) => i.code === "OWNER_INVALID"));
  assert.ok(result.issues.some((i) => i.code === "DUPLICATE_SAVE"));
});
test("an incomplete page count or auth roster blocks completeness", () => {
  const source = fixture();
  source.tables[2].recordsCount = 2;
  source.authRoster.hasMore = true;
  const result = validateExport(source);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.code === "COUNT_MISMATCH"));
  assert.ok(result.issues.some((i) => i.code === "ROSTER_INCOMPLETE"));
});
test("unknown labels and archive conflicts are preserved as review issues", () => {
  const source = fixture();
  source.tables[3].records[0].fields.status = { label: "Mystery" };
  source.tables[3].records[0].fields.archive = true;
  const result = validateExport(source);
  assert.ok(result.issues.some((i) => i.code === "UNKNOWN_STATUS"));
  assert.ok(result.issues.some((i) => i.code === "ARCHIVE_CONFLICT"));
});
test("unsafe source destinations are detected without discarding source text", () => {
  const source = fixture();
  source.tables[2].records[0].fields.url = "javascript:alert(1)";
  assert.ok(
    validateExport(source).issues.some((i) => i.code === "UNSAFE_SOURCE_URL"),
  );
  assert.equal(source.tables[2].records[0].fields.url, "javascript:alert(1)");
});
test("record hashes ignore object key order but detect content and timestamp changes", () => {
  assert.equal(
    recordHash({ a: 1, b: { x: 2, y: 3 } }),
    recordHash({ b: { y: 3, x: 2 }, a: 1 }),
  );
  assert.notEqual(recordHash({ a: 1 }), recordHash({ a: 2 }));
  assert.notEqual(
    recordHash({ updatedAt: "one" }),
    recordHash({ updatedAt: "two" }),
  );
});
test("duplicate source ids and dangling job links are rejected", () => {
  const source = fixture();
  source.tables[0].records[1].id = "owner-a";
  source.tables[3].records[0].fields.job.id = "absent";
  const result = validateExport(source);
  assert.ok(result.issues.some((i) => i.code === "DUPLICATE_SOURCE_ID"));
  assert.ok(result.issues.some((i) => i.code === "JOB_INVALID"));
});
