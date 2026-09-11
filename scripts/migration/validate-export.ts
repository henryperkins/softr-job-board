import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { outsideRepository } from "./private-files.ts";
import fieldMap from "./field-map.json" with { type: "json" };

type Row = {
  id: string;
  fields: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};
type Field = { id: string; name: string; type: string; [key: string]: unknown };
type Table = {
  id: string;
  name: string;
  fields: Field[];
  records: Row[];
  recordsCount: number;
};
export type SourceExport = {
  applicationId?: string;
  databaseId?: string;
  schemaVersion: number;
  exportStartedAt: string;
  exportEndedAt: string;
  quiescent: boolean;
  authRoster: {
    users: { id: string; email: string; status: string; active: boolean }[];
    total: number;
    hasMore: boolean;
  };
  tables: Table[];
};
export type Issue = {
  code: string;
  table?: string;
  recordId?: string;
  fieldId?: string;
};
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return (
      "{" +
      Object.keys(record)
        .sort()
        .map((key) => JSON.stringify(key) + ":" + canonical(record[key]))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(value) ?? "null";
}
export function recordHash(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
function references(value: unknown): string[] {
  return (Array.isArray(value) ? value : value ? [value] : []).flatMap(
    (item) => {
      if (typeof item === "string") return [item];
      if (
        item &&
        typeof item === "object" &&
        "id" in item &&
        typeof item.id === "string"
      )
        return [item.id];
      return [];
    },
  );
}
function label(value: unknown): unknown {
  return value && typeof value === "object" && "label" in value
    ? value.label
    : value;
}
export function validateExport(source: SourceExport) {
  const issues: Issue[] = [];
  const required = [
    "Users",
    "Candidate Profile",
    "Job Listings",
    "Saved Jobs",
    "Draft Applications",
  ];
  const tableMap = new Map<string, Table>();
  const issue = (code: string, table?: Table, record?: Row, fieldId?: string) =>
    issues.push({
      code,
      ...(table ? { table: table.name } : {}),
      ...(record ? { recordId: record.id } : {}),
      ...(fieldId ? { fieldId } : {}),
    });
  if (!source || source.schemaVersion !== 1 || !Array.isArray(source.tables)) {
    return {
      valid: false,
      cutoverReady: false,
      totalRecords: 0,
      issues: [{ code: "INVALID_EXPORT" }] as Issue[],
    };
  }
  for (const table of source.tables) {
    if (
      !table ||
      typeof table.name !== "string" ||
      !Array.isArray(table.records) ||
      !Array.isArray(table.fields)
    ) {
      issue("INVALID_TABLE");
      continue;
    }
    if (tableMap.has(table.name)) issue("DUPLICATE_TABLE", table);
    tableMap.set(table.name, table);
    const fieldIds = new Set(table.fields.map((field) => field.id));
    const fieldNames = new Set(table.fields.map((field) => field.name));
    if (
      fieldIds.size !== table.fields.length ||
      fieldNames.size !== table.fields.length
    )
      issue("SOURCE_SCHEMA_CHANGED", table);
    const contract = fieldMap.tables.find(
      (expected) => expected.sourceTableId === table.id,
    );
    if (
      contract &&
      (contract.name !== table.name ||
        contract.fields.length !== table.fields.length ||
        contract.fields.some(
          (expected) =>
            !table.fields.some(
              (field) =>
                field.id === expected.sourceFieldId &&
                field.name === expected.name &&
                field.type === expected.type,
            ),
        ))
    )
      issue("SOURCE_SCHEMA_CHANGED", table);
    if (table.recordsCount !== table.records.length)
      issue("COUNT_MISMATCH", table);
    const ids = new Set<string>();
    for (const row of table.records) {
      if (
        !row ||
        typeof row.id !== "string" ||
        !row.fields ||
        typeof row.fields !== "object"
      ) {
        issue("INVALID_RECORD", table);
        continue;
      }
      if (ids.has(row.id)) issue("DUPLICATE_SOURCE_ID", table, row);
      ids.add(row.id);
      for (const key of ["createdAt", "updatedAt"] as const) {
        if (!row[key] || !Number.isFinite(Date.parse(row[key])))
          issue("SYSTEM_TIMESTAMP_INVALID", table, row);
      }
      for (const field of table.fields) {
        const value = row.fields[field.id];
        if (
          field.type === "DATETIME" &&
          value !== null &&
          value !== undefined &&
          value !== "" &&
          (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
        )
          issue("BUSINESS_TIMESTAMP_INVALID", table, row, field.id);
      }
    }
  }
  const authoritativeSchema =
    source.applicationId !== undefined ||
    source.databaseId !== undefined ||
    source.tables.some((table) =>
      fieldMap.tables.some((expected) => expected.sourceTableId === table.id),
    );
  if (
    authoritativeSchema &&
    (source.tables.length !== fieldMap.tables.length ||
      source.tables.some(
        (table) =>
          !fieldMap.tables.some(
            (expected) => expected.sourceTableId === table.id,
          ),
      ))
  )
    issue("SOURCE_SCHEMA_CHANGED");
  if (
    (source.applicationId !== undefined &&
      source.applicationId !== "73913ca1-ce5d-4a96-95ac-598f361fb452") ||
    (source.databaseId !== undefined &&
      source.databaseId !== "a81814c7-d517-40d6-b926-66d49bba8851")
  )
    issue("SOURCE_IDENTITY_MISMATCH");
  for (const name of required)
    if (!tableMap.has(name))
      issues.push({ code: "MISSING_TABLE", table: name });
  const roster = source.authRoster;
  if (
    !roster ||
    !Array.isArray(roster.users) ||
    roster.hasMore !== false ||
    roster.users.length !== roster.total
  )
    issue("ROSTER_INCOMPLETE");
  for (const key of ["exportStartedAt", "exportEndedAt"] as const) {
    if (!source[key] || !Number.isFinite(Date.parse(source[key])))
      issue("EXPORT_TIMESTAMP_INVALID");
  }
  if (Date.parse(source.exportEndedAt) < Date.parse(source.exportStartedAt))
    issue("EXPORT_WINDOW_INVALID");
  const users = tableMap.get("Users");
  const jobs = tableMap.get("Job Listings");
  const saves = tableMap.get("Saved Jobs");
  const userIds = new Set(users?.records.filter((r) => r?.id).map((r) => r.id));
  const jobIds = new Set(jobs?.records.filter((r) => r?.id).map((r) => r.id));
  const get = (table: Table, row: Row, name: string): unknown => {
    const field = table.fields.find((f) => f.name === name);
    return field ? row.fields[field.id] : undefined;
  };
  const savedById = new Map(
    saves?.records.filter((r) => r?.id && r.fields).map((r) => [r.id, r]),
  );
  const seenSaves = new Set<string>();
  const statuses: Record<string, string[]> = {
    "Job Listings": ["Open", "Closed", "Unknown"],
    "Saved Jobs": [
      "Saved",
      "Draft Requested",
      "Draft Ready",
      "Submitted",
      "Rejected",
      "Offer",
      "Archived",
    ],
    "Draft Applications": [
      "In Progress",
      "Ready for Review",
      "Approved",
      "Needs Edits",
    ],
  };
  for (const table of tableMap.values())
    for (const row of table.records.filter((r) => r?.id && r.fields)) {
      const privateTable = [
        "Candidate Profile",
        "Saved Jobs",
        "Draft Applications",
      ].includes(table.name);
      const owners = references(
        get(table, row, table.name === "Candidate Profile" ? "Owner" : "User"),
      );
      if (privateTable && (owners.length !== 1 || !userIds.has(owners[0]!)))
        issue("OWNER_INVALID", table, row);
      if (statuses[table.name]) {
        const status = label(
          get(
            table,
            row,
            table.name === "Job Listings"
              ? "Job Status"
              : table.name === "Draft Applications"
                ? "Draft Status"
                : "Status",
          ),
        );
        if (
          typeof status !== "string" ||
          !statuses[table.name]!.includes(status)
        )
          issue("UNKNOWN_STATUS", table, row);
        if (
          table.name === "Saved Jobs" &&
          Boolean(get(table, row, "Archived")) !== (status === "Archived")
        )
          issue("ARCHIVE_CONFLICT", table, row);
      }
      if (table.name === "Job Listings") {
        const raw = get(table, row, "Source Job URL");
        if (raw) {
          try {
            const u = new URL(String(raw));
            if (
              !["https:", "http:"].includes(u.protocol) ||
              u.username ||
              u.password
            )
              issue("UNSAFE_SOURCE_URL", table, row);
          } catch {
            issue("UNSAFE_SOURCE_URL", table, row);
          }
        }
      }
      if (table.name === "Saved Jobs") {
        const links = references(get(table, row, "Job"));
        if (links.length !== 1 || !jobIds.has(links[0]!))
          issue("JOB_INVALID", table, row);
        const key = JSON.stringify([owners, links]);
        if (seenSaves.has(key)) issue("DUPLICATE_SAVE", table, row);
        seenSaves.add(key);
      }
      if (table.name === "Draft Applications") {
        const links = references(get(table, row, "Saved Job"));
        const saved = links.length === 1 ? savedById.get(links[0]!) : undefined;
        if (!saved || !saves) issue("SAVED_JOB_INVALID", table, row);
        else {
          const savedOwners = references(get(saves, saved, "User"));
          if (
            owners.length !== 1 ||
            savedOwners.length !== 1 ||
            owners[0] !== savedOwners[0]
          )
            issue("DRAFT_OWNER_MISMATCH", table, row);
        }
      }
    }
  if (users && roster && Array.isArray(roster.users)) {
    const byEmail = new Map<string, number>();
    for (const row of users.records.filter((r) => r?.id && r.fields)) {
      const raw = get(users, row, "Email");
      const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
      if (!email) issue("USER_EMAIL_MISSING", users, row);
      else byEmail.set(email, (byEmail.get(email) ?? 0) + 1);
    }
    const authEmails = new Set<string>();
    for (const auth of roster.users) {
      const email =
        typeof auth.email === "string" ? auth.email.trim().toLowerCase() : "";
      if (!email || byEmail.get(email) !== 1 || authEmails.has(email))
        issue("AUTH_CORRELATION_AMBIGUOUS");
      authEmails.add(email);
    }
  }
  const totalRecords = [...tableMap.values()].reduce(
    (sum, table) => sum + table.records.length,
    0,
  );
  // Structural validity never proves final cutover, byte reconciliation, activation, or a write freeze.
  return {
    valid: issues.length === 0,
    cutoverReady: false,
    totalRecords,
    issues,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const value = (flag: string) => {
    const index = process.argv.indexOf(flag);
    return index >= 0 ? process.argv[index + 1] : undefined;
  };
  const input = value("--manifest");
  if (!input) {
    console.error(
      "Usage: node scripts/migration/validate-export.ts --manifest <protected-source-export.json> [--report <protected-report.json>]",
    );
    process.exitCode = 2;
  } else {
    try {
      const source = JSON.parse(
        await readFile(await outsideRepository(input), "utf8"),
      ) as SourceExport;
      const report = validateExport(source);
      const output = value("--report");
      if (output)
        await writeFile(
          await outsideRepository(output, false),
          JSON.stringify(
            {
              ...report,
              contentHash: recordHash(source),
              records: source.tables.flatMap((table) =>
                table.records.map((row) => ({
                  tableId: table.id,
                  recordId: row.id,
                  sha256: recordHash(row),
                })),
              ),
            },
            null,
            2,
          ) + "\n",
          { flag: "wx", mode: 0o600 },
        );
      const issueCounts: Record<string, number> = {};
      for (const issue of report.issues)
        issueCounts[issue.code] = (issueCounts[issue.code] ?? 0) + 1;
      console.log(
        JSON.stringify({
          valid: report.valid,
          cutoverReady: false,
          totalRecords: report.totalRecords,
          issueCounts,
        }),
      );
      if (!report.valid) process.exitCode = 1;
    } catch {
      console.error(
        "Unable to validate export or write a new report; source details withheld.",
      );
      process.exitCode = 2;
    }
  }
}
