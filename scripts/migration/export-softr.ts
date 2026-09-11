import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { recordHash } from "./validate-export.ts";
import { createProtectedDirectory } from "./private-files.ts";
export { createProtectedDirectory } from "./private-files.ts";

type JsonRecord = Record<string, unknown>;
type SoftrClient = {
  callTool(input: {
    name: string;
    arguments: Record<string, unknown>;
  }): Promise<unknown>;
};
type Options = { applicationId: string; databaseId: string; pageSize?: number };
type SourceRow = {
  id: string;
  fields: JsonRecord;
  createdAt: string;
  updatedAt: string;
};
type SourceField = {
  id: string;
  name: string;
  type: string;
  [key: string]: unknown;
};
type TableMetadata = {
  id: string;
  name: string;
  recordsCount: number;
  [key: string]: unknown;
};
type SourceTable = TableMetadata & {
  fields: SourceField[];
  records: SourceRow[];
};

async function call(
  client: SoftrClient,
  name: string,
  args: JsonRecord,
): Promise<unknown> {
  const response = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content?: { type: string; text?: string }[];
  };
  if (response.isError) throw new Error("Softr read failed: " + name);
  const text = response.content
    ?.filter((item) => item.type === "text")
    .map((item) => item.text ?? "")
    .join("");
  try {
    return JSON.parse(text ?? "");
  } catch {
    throw new Error("Invalid Softr JSON: " + name);
  }
}
function array<T>(value: unknown, operation: string): T[] {
  if (!Array.isArray(value))
    throw new Error("Expected an array from " + operation);
  return value as T[];
}
export async function collectExport(client: SoftrClient, options: Options) {
  const started = new Date().toISOString();
  const limit = options.pageSize ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200)
    throw new Error("Page size must be 1..200.");
  const applications = array<{ id: string; workspaceId: string }>(
    await call(client, "list_applications", {}),
    "list_applications",
  );
  const app = applications.find((item) => item.id === options.applicationId);
  if (!app) throw new Error("Application is not accessible.");
  const application = await call(client, "get_application", {
    applicationId: app.id,
  });
  const databases = array<{ id: string }>(
    await call(client, "list_databases", { workspaceId: app.workspaceId }),
    "list_databases",
  );
  if (!databases.some((item) => item.id === options.databaseId))
    throw new Error("Database is not accessible in this workspace.");
  const tablesBefore = array<TableMetadata>(
    await call(client, "list_tables", { databaseId: options.databaseId }),
    "list_tables",
  );
  const tables: SourceTable[] = [];
  for (const table of tablesBefore) {
    const fields = array<SourceField>(
      await call(client, "list_fields", {
        databaseId: options.databaseId,
        tableId: table.id,
      }),
      "list_fields",
    );
    const records: SourceRow[] = [];
    const seen = new Set<string>();
    let complete = false;
    for (let offset = 0; offset < 1000000; offset += limit) {
      const result = await call(client, "list_records", {
        databaseId: options.databaseId,
        tableId: table.id,
        limit,
        offset,
      });
      const page = array<SourceRow>(
        Array.isArray(result)
          ? result
          : (result as { records?: unknown })?.records,
        "list_records",
      );
      if (page.length > limit)
        throw new Error("Source page exceeds requested bound.");
      for (const row of page) {
        if (!row || typeof row.id !== "string")
          throw new Error("Invalid source record identity.");
        if (seen.has(row.id))
          throw new Error("Duplicate record across source pages.");
        seen.add(row.id);
        records.push(row);
      }
      if (page.length < limit) {
        complete = true;
        break;
      }
    }
    if (!complete)
      throw new Error("Export page limit reached; not a complete export.");
    if (records.length !== table.recordsCount)
      throw new Error("Source count changed or pagination is incomplete.");
    tables.push({ ...table, fields, records } as SourceTable);
  }
  const authUsers: {
    id: string;
    email: string;
    status: string;
    active: boolean;
  }[] = [];
  const authIds = new Set<string>();
  let authTotal = 0;
  let rosterComplete = false;
  for (let page = 0; page < 1000; page++) {
    const response = (await call(client, "list_application_users", {
      applicationId: app.id,
      limit: 100,
      page,
    })) as { users: typeof authUsers; total: number; hasMore: boolean };
    for (const user of array<(typeof authUsers)[number]>(
      response.users,
      "list_application_users",
    )) {
      if (!user?.id || authIds.has(user.id))
        throw new Error("Duplicate or invalid auth identity.");
      authIds.add(user.id);
      authUsers.push(user);
    }
    authTotal = response.total;
    if (response.hasMore === false) {
      rosterComplete = true;
      break;
    }
    if (response.users.length === 0)
      throw new Error("Auth roster pagination did not advance.");
  }
  if (!rosterComplete || authUsers.length !== authTotal)
    throw new Error("Auth roster export incomplete.");
  const tablesAfter = array<TableMetadata>(
    await call(client, "list_tables", { databaseId: options.databaseId }),
    "list_tables",
  );
  return {
    schemaVersion: 1,
    source: "softr-builder-mcp",
    applicationId: app.id,
    databaseId: options.databaseId,
    exportStartedAt: started,
    exportEndedAt: new Date().toISOString(),
    quiescent: false,
    snapshotConsistency: "not-established",
    application,
    inventoryChangedDuringExport:
      recordHash(tablesBefore) !== recordHash(tablesAfter),
    authRoster: { users: authUsers, total: authTotal, hasMore: false },
    tables,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const index = process.argv.indexOf("--out-dir");
  const destination = index >= 0 ? process.argv[index + 1] : undefined;
  const token = process.env.SOFTR_WORKSPACE_TOKEN;
  if (!destination || !token) {
    console.error(
      "Provide --out-dir <new protected directory outside repository> and SOFTR_WORKSPACE_TOKEN.",
    );
    process.exitCode = 2;
  } else {
    let client: { close(): Promise<void> } | undefined;
    try {
      const folder = await createProtectedDirectory(destination);
      const { Client } =
        await import("@modelcontextprotocol/sdk/client/index.js");
      const { StreamableHTTPClientTransport } =
        await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
      const connection = new Client({
        name: "softr-job-board-migration",
        version: "1.0.0",
      });
      client = connection;
      await connection.connect(
        new StreamableHTTPClientTransport(new URL("https://mcp.softr.io/mcp"), {
          requestInit: { headers: { Authorization: "Bearer " + token } },
        }),
      );
      const result = await collectExport(connection, {
        applicationId: "73913ca1-ce5d-4a96-95ac-598f361fb452",
        databaseId: "a81814c7-d517-40d6-b926-66d49bba8851",
      });
      await writeFile(
        path.join(folder, "source-export.json"),
        JSON.stringify(result, null, 2) + "\n",
        { mode: 0o600, flag: "wx" },
      );
      const manifest = {
        schemaVersion: 1,
        sourceFile: "source-export.json",
        sha256: recordHash(result),
        exportStartedAt: result.exportStartedAt,
        exportEndedAt: result.exportEndedAt,
        quiescent: false,
        inventoryChangedDuringExport: result.inventoryChangedDuringExport,
        tables: result.tables.map((t) => ({
          id: t.id,
          name: t.name,
          count: t.records.length,
          schemaHash: recordHash(t.fields),
          records: t.records.map((r) => ({ id: r.id, sha256: recordHash(r) })),
        })),
      };
      await writeFile(
        path.join(folder, "export-manifest.json"),
        JSON.stringify(manifest, null, 2) + "\n",
        { mode: 0o600, flag: "wx" },
      );
      console.log(
        JSON.stringify({
          exported: true,
          tables: result.tables.map((t) => ({
            name: t.name,
            count: t.records.length,
          })),
          quiescent: false,
          inventoryChangedDuringExport: result.inventoryChangedDuringExport,
        }),
      );
    } catch {
      console.error(
        "Export failed; no completed export is claimed. Credentials and source responses are withheld.",
      );
      process.exitCode = 1;
    } finally {
      await client?.close();
    }
  }
}
