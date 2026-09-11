import { DataService } from "./services";
import { DomainError } from "../../domain/src/contracts";
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export function detectedType(bytes: Uint8Array): string | null {
  const starts = (v: number[]) => v.every((x, i) => bytes[i] === x);
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return "image/png";
  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (
    starts([0x52, 0x49, 0x46, 0x46]) &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  )
    return "image/webp";
  return null;
}
export function decodeCursor(cursor?: string) {
  if (!cursor) return null;
  try {
    const v: unknown = JSON.parse(atob(cursor));
    if (
      Array.isArray(v) &&
      v.length === 2 &&
      v.every((x) => typeof x === "string")
    )
      return v as [string, string];
  } catch {
    /* invalid below */
  }
  throw new DomainError("invalid_cursor", 400);
}
export class UserFlowService extends DataService {
  async archive(id: string, expectedRevision: number, archived: boolean) {
    const p = await this.profile(id);
    if (p.revision !== expectedRevision)
      throw new DomainError("revision_conflict", 409);
    const stamp = new Date().toISOString(),
      version = crypto.randomUUID();
    const result = await this.db.batch([
      this.db
        .prepare(
          "UPDATE candidate_profiles SET archived_at=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=? AND revision=?",
        )
        .bind(
          archived ? stamp : null,
          stamp,
          id,
          this.actor.id,
          expectedRevision,
        ),
      this.db
        .prepare(
          "INSERT INTO profile_versions(id,profile_id,user_id,revision,name,content_json,created_at,archived_at) SELECT ?,id,user_id,revision,name,content_json,?,archived_at FROM candidate_profiles WHERE id=? AND user_id=? AND changes()=1",
        )
        .bind(version, stamp, id, this.actor.id),
      this.db
        .prepare(
          "INSERT INTO audit_events(id,actor_user_id,action,entity_type,entity_id,revision,created_at) SELECT ?,?,?,'profile',?,?,? WHERE changes()=1",
        )
        .bind(
          crypto.randomUUID(),
          this.actor.id,
          archived ? "archive" : "restore",
          id,
          expectedRevision + 1,
          stamp,
        ),
      this.db
        .prepare(
          "DELETE FROM active_profiles WHERE user_id=? AND profile_id=? AND EXISTS(SELECT 1 FROM candidate_profiles WHERE id=? AND archived_at IS NOT NULL)",
        )
        .bind(this.actor.id, id, id),
    ]);
    if (!result[0].meta.changes)
      throw new DomainError("revision_conflict", 409);
    return this.getProfile(id);
  }
  async attachments(id: string) {
    await this.profile(id);
    const rows = await this.db
      .prepare(
        "SELECT id,filename,media_type AS mediaType,size_bytes AS sizeBytes,status,scan_status AS scanStatus,created_at AS createdAt FROM attachments WHERE profile_id=? AND user_id=? ORDER BY created_at DESC,id DESC",
      )
      .bind(id, this.actor.id)
      .all();
    return { items: rows.results };
  }
  async upload(
    id: string,
    expectedRevision: number,
    file: File,
    bucket: R2Bucket,
  ) {
    const p = await this.profile(id);
    if (p.archived_at) throw new DomainError("profile_archived", 409);
    if (p.revision !== expectedRevision)
      throw new DomainError("revision_conflict", 409);
    if (!file.size || file.size > MAX_UPLOAD_BYTES)
      throw new DomainError("file_size_invalid", 413);
    const bytes = await file.arrayBuffer(),
      type = detectedType(new Uint8Array(bytes));
    if (!type || type !== file.type)
      throw new DomainError("file_type_invalid", 400);
    const checksum = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      (x) => x.toString(16).padStart(2, "0"),
    ).join("");
    const attachmentId = crypto.randomUUID(),
      versionId = crypto.randomUUID(),
      stamp = new Date().toISOString();
    const key = `profiles/${this.actor.id}/${id}/${versionId}/${attachmentId}`;
    const content = JSON.parse(p.content_json) as Record<string, unknown>;
    content.attachmentIds = [
      ...(Array.isArray(content.attachmentIds)
        ? (content.attachmentIds as unknown[])
        : []),
      attachmentId,
    ];
    await bucket.put(key, bytes, {
      httpMetadata: { contentType: type },
      sha256: checksum,
    });
    try {
      const result = await this.db.batch([
        this.db
          .prepare(
            "UPDATE candidate_profiles SET content_json=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=? AND revision=? AND archived_at IS NULL",
          )
          .bind(
            JSON.stringify(content),
            stamp,
            id,
            this.actor.id,
            expectedRevision,
          ),
        this.db
          .prepare(
            "INSERT INTO attachments(id,user_id,profile_id,object_key,filename,media_type,size_bytes,checksum_sha256,status,scan_status,created_at) SELECT ?,?,?,?,?,?,?,?,'pending','pending',? WHERE changes()=1",
          )
          .bind(
            attachmentId,
            this.actor.id,
            id,
            key,
            file.name.slice(0, 250),
            type,
            file.size,
            checksum,
            stamp,
          ),
        this.db
          .prepare(
            "INSERT INTO profile_versions(id,profile_id,user_id,revision,name,content_json,created_at) SELECT ?,id,user_id,revision,name,content_json,? FROM candidate_profiles WHERE id=? AND user_id=? AND changes()=1",
          )
          .bind(versionId, stamp, id, this.actor.id),
        this.db
          .prepare(
            "INSERT INTO audit_events(id,actor_user_id,action,entity_type,entity_id,revision,created_at) SELECT ?,?,'upload','profile',?,?,? WHERE changes()=1",
          )
          .bind(
            crypto.randomUUID(),
            this.actor.id,
            id,
            expectedRevision + 1,
            stamp,
          ),
      ]);
      if (!result[0].meta.changes)
        throw new DomainError("revision_conflict", 409);
    } catch (error) {
      // Only this request's random immutable key is eligible for orphan cleanup.
      // A committed metadata row is retained if a response was ambiguous.
      const committed = await this.db
        .prepare("SELECT id FROM attachments WHERE id=? AND object_key=?")
        .bind(attachmentId, key)
        .first();
      if (!committed) await bucket.delete(key);
      throw error;
    }
    return {
      attachment: {
        id: attachmentId,
        status: "pending",
        scanStatus: "pending",
      },
      profile: await this.getProfile(id),
    };
  }
  async draftList(id: string) {
    const saved = await this.save(id);
    const rows = await this.db
      .prepare(
        "SELECT id,revision,status,execution_status AS executionStatus,updated_at AS updatedAt FROM draft_applications WHERE saved_job_id=? AND user_id=? ORDER BY updated_at DESC,id DESC",
      )
      .bind(saved.id, this.actor.id)
      .all();
    return { items: rows.results };
  }
  async draftHistory(id: string) {
    await this.draft(id);
    const rows = await this.db
      .prepare(
        "SELECT id,revision,cover_letter AS coverLetter,short_answers AS shortAnswers,reviewer_notes AS reviewerNotes,status,created_at AS createdAt FROM draft_versions WHERE draft_id=? AND user_id=? ORDER BY revision DESC",
      )
      .bind(id, this.actor.id)
      .all();
    return { items: rows.results };
  }
  async activity(limit = 25, cursor?: string) {
    const boundary = decodeCursor(cursor);
    const rows = await this.db
      .prepare(
        `SELECT id,action,entity_type AS entityType,entity_id AS entityId,revision,created_at AS createdAt FROM audit_events WHERE actor_user_id=? ${boundary ? "AND (created_at < ? OR (created_at = ? AND id < ?))" : ""} ORDER BY created_at DESC,id DESC LIMIT ?`,
      )
      .bind(
        this.actor.id,
        ...(boundary ? [boundary[0], boundary[0], boundary[1]] : []),
        limit + 1,
      )
      .all<{ id: string; createdAt: string }>();
    const items = rows.results.slice(0, limit),
      last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.results.length > limit && last
          ? btoa(JSON.stringify([last.createdAt, last.id]))
          : null,
    };
  }
  async jobOptions() {
    const options: Record<string, string[]> = {};
    for (const key of ["remote", "employment", "seniority"]) {
      const rows = await this.db
        .prepare(
          `SELECT DISTINCT ${key} AS value FROM jobs WHERE ${key} IS NOT NULL AND ${key} != '' ORDER BY ${key}`,
        )
        .all<{ value: string }>();
      options[key] = rows.results.map((r) => r.value);
    }
    return options;
  }
}
