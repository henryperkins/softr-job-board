import type { MigrationDatabase } from "./import-d1.ts";
import type { MappedRecord } from "./map-records.ts";

const rootTables = new Set([
  "users",
  "candidate_profiles",
  "jobs",
  "saved_jobs",
  "draft_applications",
  "attachments",
]);
export const sourceKey = (table: unknown, id: unknown) =>
  JSON.stringify([table, id]);
export async function readTarget(
  db: MigrationDatabase,
  records: MappedRecord[],
  includeMappings = false,
) {
  const roots = new Map<string, Record<string, unknown>>();
  for (const table of new Set(records.map((record) => record.table))) {
    if (!rootTables.has(table)) throw new Error("Invalid migration target.");
    const ids = records
      .filter((record) => record.table === table)
      .map((record) => record.id);
    for (let offset = 0; offset < ids.length; offset += 90) {
      const chunk = ids.slice(offset, offset + 90);
      const rows = await db
        .prepare(
          "SELECT * FROM " +
            table +
            " WHERE id IN (" +
            chunk.map(() => "?").join(",") +
            ")",
        )
        .bind(...chunk)
        .all();
      for (const row of rows.results) roots.set(sourceKey(table, row.id), row);
    }
  }
  const snapshots = new Map<string, Record<string, unknown>>();
  const mappings = new Map<string, Record<string, unknown>>();
  for (const table of new Set(records.map((record) => record.sourceTable))) {
    const ids = records
      .filter((record) => record.sourceTable === table)
      .map((record) => record.sourceId);
    for (let offset = 0; offset < ids.length; offset += 90) {
      const chunk = ids.slice(offset, offset + 90);
      const suffix =
        " WHERE source_system=? AND source_table=? AND source_id IN (" +
        chunk.map(() => "?").join(",") +
        ")";
      for (const [target, index] of [
        ["legacy_record_snapshots", snapshots],
        ...(includeMappings ? [["legacy_id_map", mappings] as const] : []),
      ] as const) {
        const rows = await db
          .prepare("SELECT * FROM " + target + suffix)
          .bind("softr", table, ...chunk)
          .all();
        for (const row of rows.results)
          index.set(sourceKey(row.source_table, row.source_id), row);
      }
    }
  }
  return { roots, snapshots, mappings };
}
