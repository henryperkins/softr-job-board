import test from "node:test";
import assert from "node:assert/strict";
import { collectExport } from "../../scripts/migration/export-softr.ts";
function clientFor(rows, options = {}) {
  const offsets = [];
  return {
    offsets,
    async callTool({ name, arguments: args = {} }) {
      let value;
      if (name === "list_applications")
        value = [{ id: "app", workspaceId: "workspace" }];
      else if (name === "get_application")
        value = { id: "app", workspaceId: "workspace" };
      else if (name === "list_databases") value = [{ id: "db" }];
      else if (name === "list_tables")
        value = [{ id: "table", name: "Example", recordsCount: rows.length }];
      else if (name === "list_fields")
        value = [{ id: "f", name: "Field", type: "SINGLE_LINE_TEXT" }];
      else if (name === "list_records") {
        offsets.push(args.offset);
        value = rows.slice(args.offset, args.offset + args.limit);
        if (options.failOffset === args.offset)
          return {
            isError: true,
            content: [{ type: "text", text: "secret-bearing upstream error" }],
          };
      } else if (name === "list_application_users")
        value = { users: [], hasMore: false, total: 0, page: 0, limit: 100 };
      else throw Error(name);
      return { content: [{ type: "text", text: JSON.stringify(value) }] };
    },
  };
}
test("export continues after a full page and retains system timestamps", async () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({
    id: "r" + i,
    fields: { f: i },
    createdAt: "2026-01-01",
    updatedAt: "2026-09-11",
  }));
  const client = clientFor(rows);
  const result = await collectExport(client, {
    applicationId: "app",
    databaseId: "db",
    pageSize: 2,
  });
  assert.deepEqual(client.offsets, [0, 2, 4]);
  assert.equal(result.tables[0].records.length, 5);
  assert.equal(result.tables[0].records[4].updatedAt, "2026-09-11");
  assert.equal(result.quiescent, false);
});
test("an error mid-export fails without leaking upstream error text", async () => {
  const client = clientFor([{ id: "1" }, { id: "2" }, { id: "3" }], {
    failOffset: 2,
  });
  await assert.rejects(
    collectExport(client, {
      applicationId: "app",
      databaseId: "db",
      pageSize: 2,
    }),
    (error) =>
      !error.message.includes("secret-bearing") &&
      error.message.includes("list_records"),
  );
});
test("unavailable application is rejected before accessing unrelated data", async () => {
  let reads = 0;
  const client = {
    async callTool() {
      reads++;
      return { content: [{ type: "text", text: "[]" }] };
    },
  };
  await assert.rejects(
    collectExport(client, { applicationId: "not-found", databaseId: "db" }),
    /Application/,
  );
  assert.equal(reads, 1);
});
test("duplicate record delivery is rejected rather than silently counted twice", async () => {
  const client = clientFor([{ id: "same" }, { id: "same" }]);
  await assert.rejects(
    collectExport(client, { applicationId: "app", databaseId: "db" }),
    /Duplicate record/,
  );
});
