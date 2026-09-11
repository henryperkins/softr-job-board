import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { mapRecords, type MappedRecord } from "./map-records.ts";
import {
  recordHash,
  type Issue,
  type SourceExport,
} from "./validate-export.ts";
import type { Manifest } from "./copy-attachments.ts";
import type { MigrationDatabase } from "./import-d1.ts";
import { readTarget, sourceKey } from "./read-target.ts";

export interface PrivateBucket {
  get(
    key: string,
  ): Promise<{ size: number; arrayBuffer(): Promise<ArrayBuffer> } | null>;
  put(
    key: string,
    bytes: Uint8Array,
    options?: { httpMetadata?: { contentType: string } },
  ): Promise<unknown>;
}
const hashBytes = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const allRecords = (mapped: ReturnType<typeof mapRecords>) => [
  ...mapped.users,
  ...mapped.profiles,
  ...mapped.jobs,
  ...mapped.savedJobs,
  ...mapped.drafts,
  ...mapped.attachments,
];
async function objectMatches(bucket: PrivateBucket, record: MappedRecord) {
  const key = record.core.object_key;
  if (typeof key !== "string") return "R2_OBJECT_MISSING";
  const object = await bucket.get(key);
  if (!object) return "R2_OBJECT_MISSING";
  if (object.size !== record.core.size_bytes || object.size > 50 * 1024 * 1024)
    return "R2_SIZE_MISMATCH";
  if (
    hashBytes(new Uint8Array(await object.arrayBuffer())) !==
    record.core.checksum_sha256
  )
    return "R2_CHECKSUM_MISMATCH";
  return null;
}
export async function copyToPrivateR2(
  bucket: PrivateBucket,
  source: SourceExport,
  files: Manifest,
  archive: string,
) {
  const mapped = mapRecords(source, files);
  if (mapped.issues.length)
    throw new Error("Source/file mapping is not valid.");
  let copied = 0,
    unchanged = 0;
  for (const record of mapped.attachments) {
    if (!(await objectMatches(bucket, record))) {
      unchanged++;
      continue;
    }
    const checksum = record.core.checksum_sha256;
    if (
      typeof checksum !== "string" ||
      !/^[a-f0-9]{64}$/.test(checksum) ||
      typeof record.core.object_key !== "string"
    )
      throw new Error("Invalid file identity.");
    // Derive the filename from a checked digest, never a manifest-supplied path.
    const filename = path.join(archive, "attachments", checksum + ".bin");
    const metadata = await stat(filename);
    if (
      !metadata.isFile() ||
      metadata.size !== record.core.size_bytes ||
      metadata.size > 50 * 1024 * 1024
    )
      throw new Error("Local file size mismatch.");
    const bytes = await readFile(filename);
    if (hashBytes(bytes) !== checksum)
      throw new Error("Local file checksum mismatch.");
    await bucket.put(record.core.object_key, bytes, {
      httpMetadata: { contentType: "application/octet-stream" },
    });
    if (await objectMatches(bucket, record))
      throw new Error("Private object verification failed.");
    copied++;
  }
  // Copying preserves quarantine: no scan result or availability is invented.
  return { copied, unchanged, scanStatus: "pending", available: 0 };
}

export async function reconcile(
  db: MigrationDatabase,
  bucket: PrivateBucket,
  source: SourceExport,
  files: Manifest,
) {
  const mapped = mapRecords(source, files);
  const issues: Issue[] = [...mapped.issues];
  const records = allRecords(mapped);
  const counts: Record<string, number> = {};
  const target = await readTarget(db, records, true);
  const historyRows = await db
    .prepare(
      "SELECT m.*,v.fields_json FROM import_record_versions m JOIN legacy_snapshot_versions v ON v.source_system=m.source_system AND v.source_table=m.source_table AND v.source_id=m.source_id AND v.source_hash=m.source_hash WHERE m.manifest_id=?",
    )
    .bind("import_" + mapped.sourceHash)
    .all();
  const history = new Map(
    historyRows.results.map((row) => [
      sourceKey(row.source_table, row.source_id),
      row,
    ]),
  );
  const versions = new Set<string>();
  for (const [root, version, foreignKey] of [
    ["candidate_profiles", "profile_versions", "profile_id"],
    ["jobs", "job_versions", "job_id"],
    ["draft_applications", "draft_versions", "draft_id"],
  ]) {
    const ids = records
      .filter((record) => record.table === root)
      .map((record) => record.id);
    for (let offset = 0; offset < ids.length; offset += 90) {
      const chunk = ids.slice(offset, offset + 90);
      const rows = await db
        .prepare(
          "SELECT v." +
            foreignKey +
            " AS parent_id,v.revision FROM " +
            version +
            " v JOIN " +
            root +
            " r ON r.id=v." +
            foreignKey +
            " AND r.revision=v.revision WHERE r.id IN (" +
            chunk.map(() => "?").join(",") +
            ")",
        )
        .bind(...chunk)
        .all();
      for (const row of rows.results)
        versions.add(JSON.stringify([root, row.parent_id, row.revision]));
    }
  }
  if (!issues.length)
    for (const record of records) {
      counts[record.table] = (counts[record.table] ?? 0) + 1;
      const issue = (code: string) =>
        issues.push({
          code,
          table: record.sourceTable,
          recordId: record.sourceId,
        });
      const row = target.roots.get(sourceKey(record.table, record.id));
      const snapshot = target.snapshots.get(
        sourceKey(record.sourceTable, record.sourceId),
      );
      const legacy = target.mappings.get(
        sourceKey(record.sourceTable, record.sourceId),
      );
      const historic = history.get(
        sourceKey(record.sourceTable, record.sourceId),
      );
      if (
        !historic ||
        historic.source_hash !== record.sourceHash ||
        recordHash(JSON.parse(String(historic.fields_json))) !==
          recordHash(record.fields) ||
        historic.target_hash !== snapshot?.target_hash ||
        historic.target_table !== record.table ||
        historic.target_id !== record.id
      )
        issue("IMMUTABLE_SNAPSHOT_MISMATCH");
      if (!row || !snapshot || !legacy) {
        issue("TARGET_ROW_OR_MAPPING_MISSING");
        continue;
      }
      if (
        snapshot.source_hash !== record.sourceHash ||
        recordHash(JSON.parse(String(snapshot.fields_json))) !==
          recordHash(record.fields) ||
        snapshot.present_in_source !== 1
      )
        issue("SOURCE_SNAPSHOT_MISMATCH");
      if (
        legacy.target_table !== record.table ||
        legacy.target_id !== record.id
      )
        issue("LEGACY_MAPPING_MISMATCH");
      const expected = { ...record.core };
      if (
        record.table === "draft_applications" &&
        expected.status === "Approved"
      )
        expected.approved_revision = Number(row.revision);
      if (
        recordHash(
          Object.fromEntries(
            Object.keys(expected).map((key) => [key, row[key]]),
          ),
        ) !== recordHash(expected)
      )
        issue("TARGET_CONTENT_MISMATCH");
      const keys = [
        ...Object.keys(record.core),
        "created_at",
        ...(record.table !== "attachments" ? ["updated_at"] : []),
        ...(row.revision !== undefined ? ["revision"] : []),
      ];
      if (
        recordHash(
          Object.fromEntries(keys.map((key) => [key, row[key] ?? null])),
        ) !== snapshot.target_hash
      )
        issue("TARGET_DRIFT");
      if (record.table === "attachments") {
        const failure = await objectMatches(bucket, record);
        if (failure) issue(failure);
      }
      const versionTable =
        record.table === "candidate_profiles"
          ? ["profile_versions", "profile_id"]
          : record.table === "jobs"
            ? ["job_versions", "job_id"]
            : record.table === "draft_applications"
              ? ["draft_versions", "draft_id"]
              : null;
      if (
        versionTable &&
        !versions.has(
          JSON.stringify([record.table, record.id, Number(row.revision)]),
        )
      )
        issue("VERSION_MISSING");
    }
  const foreignKeys = await db.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeys.results.length)
    issues.push({ code: "TARGET_FOREIGN_KEY_INVALID" });
  const present = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM legacy_record_snapshots WHERE source_system=? AND present_in_source=1",
    )
    .bind("softr")
    .first<{ n: number }>();
  if (present?.n !== records.length)
    issues.push({ code: "SNAPSHOT_COUNT_MISMATCH" });
  for (const auth of source.authRoster.users) {
    const historic = history.get(sourceKey("auth_roster", auth.id));
    if (
      !historic ||
      historic.source_hash !== recordHash(auth) ||
      recordHash(JSON.parse(String(historic.fields_json))) !== recordHash(auth)
    )
      issues.push({ code: "AUTH_HISTORY_MISMATCH" });
    const row = await db
      .prepare(
        "SELECT source_email,source_status,source_active FROM legacy_auth_roster WHERE source_auth_id=?",
      )
      .bind(auth.id)
      .first();
    if (
      !row ||
      row.source_email !== auth.email ||
      row.source_status !== auth.status ||
      row.source_active !== (auth.active ? 1 : 0)
    )
      issues.push({ code: "AUTH_ROSTER_MISMATCH" });
  }
  return {
    structurallyReconciled: issues.length === 0,
    counts,
    attachmentReferences: mapped.attachments.length,
    issues,
    releaseReady: false,
    pending: [
      "quiescent-final-export",
      "verified-identity-claims",
      "malware-scanning",
      "live-route-and-owner-acceptance",
    ],
  };
}
