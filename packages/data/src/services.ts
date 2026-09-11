import {
  canTransition,
  DomainError,
  safeUrl,
  type SavedLabel,
} from "../../domain/src/contracts";
import type { z } from "zod";
import type {
  profileCreateSchema,
  profilePatchSchema,
  savePatchSchema,
  draftPatchSchema,
  jobQuerySchema,
} from "../../domain/src/contracts";
export type Actor = { id: string; email: string; name: string };
type Profile = {
  id: string;
  user_id: string;
  revision: number;
  name: string;
  content_json: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};
type Save = {
  id: string;
  user_id: string;
  job_id: string;
  revision: number;
  notes: string | null;
  priority: string | null;
  status: SavedLabel | null;
  outcome_notes: string | null;
  submission_url: string | null;
  created_at: string;
  updated_at: string;
};
type Draft = {
  id: string;
  user_id: string;
  saved_job_id: string;
  revision: number;
  status: string | null;
  execution_status: string;
  cover_letter: string | null;
  short_answers: string | null;
  reviewer_notes: string | null;
  approved_revision: number | null;
  provenance: string;
  created_at: string;
  updated_at: string;
};
type DraftSummary = {
  id: string;
  status: string | null;
  execution_status: string;
  revision: number;
};
type Job = {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  remote: string | null;
  employment: string | null;
  seniority: string | null;
  source_url: string | null;
  description: string | null;
  status: string | null;
  created_at: string;
  legacy_id: string | null;
};
const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
export class DataService {
  constructor(
    readonly db: D1Database,
    readonly actor: Actor,
  ) {}
  private audit(
    action: string,
    type: string,
    id: string,
    revision: number | null = null,
  ) {
    return this.db
      .prepare(
        "INSERT INTO audit_events(id,actor_user_id,action,entity_type,entity_id,revision,created_at) VALUES(?,?,?,?,?,?,?)",
      )
      .bind(uid(), this.actor.id, action, type, id, revision, now());
  }
  private conditionalAudit(
    action: string,
    type: string,
    id: string,
    revision: number,
  ) {
    return this.db
      .prepare(
        "INSERT INTO audit_events(id,actor_user_id,action,entity_type,entity_id,revision,created_at) SELECT ?,?,?,?,?,?,? WHERE changes()=1",
      )
      .bind(uid(), this.actor.id, action, type, id, revision, now());
  }
  private profileOut(p: Profile) {
    return {
      id: p.id,
      revision: p.revision,
      name: p.name,
      content: JSON.parse(p.content_json) as unknown,
      archived: !!p.archived_at,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    };
  }
  async profiles() {
    const rows = await this.db
      .prepare(
        "SELECT * FROM candidate_profiles WHERE user_id=? ORDER BY created_at,id",
      )
      .bind(this.actor.id)
      .all<Profile>();
    const active = await this.db
      .prepare(
        "SELECT profile_id,profile_version_id FROM active_profiles WHERE user_id=?",
      )
      .bind(this.actor.id)
      .first<{ profile_id: string; profile_version_id: string | null }>();
    return {
      items: rows.results.map((p) => ({
        ...this.profileOut(p),
        active: p.id === active?.profile_id,
      })),
      activeProfileId: active?.profile_id ?? null,
      activeProfileVersionId: active?.profile_version_id ?? null,
    };
  }
  async profile(id: string) {
    const p = await this.db
      .prepare("SELECT * FROM candidate_profiles WHERE id=? AND user_id=?")
      .bind(id, this.actor.id)
      .first<Profile>();
    if (!p) throw new DomainError("not_found", 404);
    return p;
  }
  async getProfile(id: string) {
    return this.profileOut(await this.profile(id));
  }
  async createProfile(input: z.infer<typeof profileCreateSchema>) {
    const id = uid(),
      stamp = now(),
      key = input.idempotencyKey ?? uid(),
      content = JSON.stringify(input.content);
    await this.db.batch([
      this.db
        .prepare(
          "INSERT INTO candidate_profiles(id,user_id,name,content_json,created_at,updated_at) SELECT ?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM profile_create_requests WHERE user_id=? AND idempotency_key=?)",
        )
        .bind(
          id,
          this.actor.id,
          input.name,
          content,
          stamp,
          stamp,
          this.actor.id,
          key,
        ),
      this.db
        .prepare(
          "INSERT INTO profile_versions(id,profile_id,user_id,revision,name,content_json,created_at) SELECT ?,id,user_id,1,name,content_json,? FROM candidate_profiles WHERE id=? AND changes()=1",
        )
        .bind(uid(), stamp, id),
      this.conditionalAudit("create", "profile", id, 1),
      this.db
        .prepare(
          "INSERT INTO profile_create_requests(user_id,idempotency_key,profile_id) SELECT ?,?,? WHERE changes()=1",
        )
        .bind(this.actor.id, key, id),
    ]);
    const saved = await this.db
      .prepare(
        "SELECT profile_id FROM profile_create_requests WHERE user_id=? AND idempotency_key=?",
      )
      .bind(this.actor.id, key)
      .first<{ profile_id: string }>();
    if (!saved) throw new Error("profile_create_missing");
    return this.getProfile(saved.profile_id);
  }
  async editProfile(id: string, input: z.infer<typeof profilePatchSchema>) {
    const p = await this.profile(id);
    if (p.archived_at) throw new DomainError("profile_archived", 409);
    if (p.revision !== input.expectedRevision)
      throw new DomainError("revision_conflict", 409);
    const stamp = now();
    const results = await this.db.batch([
      this.db
        .prepare(
          "UPDATE candidate_profiles SET name=?,content_json=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=? AND revision=?",
        )
        .bind(
          input.name ?? p.name,
          input.content === undefined
            ? p.content_json
            : JSON.stringify({
                ...(JSON.parse(p.content_json) as Record<string, unknown>),
                ...input.content,
              }),
          stamp,
          id,
          this.actor.id,
          input.expectedRevision,
        ),
      this.db
        .prepare(
          "INSERT INTO profile_versions(id,profile_id,user_id,revision,name,content_json,created_at) SELECT ?,id,user_id,revision,name,content_json,? FROM candidate_profiles WHERE id=? AND user_id=? AND changes()=1",
        )
        .bind(uid(), stamp, id, this.actor.id),
      this.conditionalAudit("edit", "profile", id, input.expectedRevision + 1),
    ]);
    if (!results[0].meta.changes)
      throw new DomainError("revision_conflict", 409);
    return this.getProfile(id);
  }
  async activateProfile(id: string) {
    const p = await this.profile(id);
    if (p.archived_at) throw new DomainError("profile_archived", 409);
    const result = await this.db.batch([
      this.db
        .prepare(
          "INSERT INTO active_profiles(user_id,profile_id,profile_version_id) SELECT user_id,id,(SELECT id FROM profile_versions WHERE profile_id=candidate_profiles.id ORDER BY revision DESC LIMIT 1) FROM candidate_profiles WHERE user_id=? AND id=? AND archived_at IS NULL ON CONFLICT(user_id) DO UPDATE SET profile_id=excluded.profile_id,profile_version_id=excluded.profile_version_id",
        )
        .bind(this.actor.id, id),
      this.conditionalAudit("activate", "profile", id, p.revision),
    ]);
    if (!result[0].meta.changes) throw new DomainError("profile_archived", 409);
    return { activeProfileId: id };
  }
  async jobs(query: z.infer<typeof jobQuerySchema>) {
    const clauses: string[] = [],
      values: (string | number)[] = [];
    if (query.q) {
      clauses.push(
        "(title LIKE ? ESCAPE char(92) OR company LIKE ? ESCAPE char(92))",
      );
      const q = `%${query.q.replace(/[\\%_]/g, "\\$&")}%`;
      values.push(q, q);
    }
    for (const key of ["remote", "employment", "seniority", "status"] as const)
      if (query[key]) {
        clauses.push(`${key}=?`);
        values.push(query[key]);
      }
    if (query.cursor) {
      let cursor: unknown;
      try {
        cursor = JSON.parse(atob(query.cursor));
      } catch {
        throw new DomainError("invalid_cursor", 400);
      }
      if (
        !Array.isArray(cursor) ||
        cursor.length !== 2 ||
        !cursor.every((v) => typeof v === "string")
      )
        throw new DomainError("invalid_cursor", 400);
      clauses.push("(created_at < ? OR (created_at = ? AND id < ?))");
      values.push(String(cursor[0]), String(cursor[0]), String(cursor[1]));
    }
    const rows = await this.db
      .prepare(
        `SELECT * FROM jobs ${clauses.length ? "WHERE " + clauses.join(" AND ") : ""} ORDER BY created_at DESC,id DESC LIMIT ?`,
      )
      .bind(...values, query.limit + 1)
      .all<Job>();
    const more = rows.results.length > query.limit;
    const items = rows.results.slice(0, query.limit);
    const last = items.at(-1);
    return {
      items: items.map(jobOut),
      nextCursor:
        more && last ? btoa(JSON.stringify([last.created_at, last.id])) : null,
    };
  }
  async job(id: string) {
    const row = await this.db
      .prepare(
        "SELECT * FROM jobs WHERE id=? OR legacy_id=? ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END LIMIT 1",
      )
      .bind(id, id, id)
      .first<Job>();
    if (!row) throw new DomainError("not_found", 404);
    return jobOut(row);
  }
  async save(id: string) {
    const row = await this.db
      .prepare(
        "SELECT * FROM saved_jobs WHERE (id=? OR legacy_id=?) AND user_id=? ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END LIMIT 1",
      )
      .bind(id, id, this.actor.id, id)
      .first<Save>();
    if (!row) throw new DomainError("not_found", 404);
    return row;
  }
  private async saveOut(
    s: Save,
    loadedDraft?: DraftSummary | null,
    loadedJob?: { title: string; company: string | null },
  ) {
    const job =
      loadedJob ??
      (await this.db
        .prepare("SELECT title,company FROM jobs WHERE id=?")
        .bind(s.job_id)
        .first<{ title: string; company: string | null }>());
    const draft =
      loadedDraft === undefined
        ? await this.db
            .prepare(
              "SELECT id,status,execution_status,revision FROM draft_applications WHERE saved_job_id=? AND user_id=? ORDER BY updated_at DESC,id DESC LIMIT 1",
            )
            .bind(s.id, this.actor.id)
            .first<DraftSummary>()
        : loadedDraft;
    return {
      id: s.id,
      jobId: s.job_id,
      job,
      revision: s.revision,
      notes: s.notes,
      priority: s.priority,
      status: s.status,
      outcomeNotes: s.outcome_notes,
      submissionUrl: safeUrl(s.submission_url),
      createdAt: s.created_at,
      updatedAt: s.updated_at,
      draft: draft
        ? {
            id: draft.id,
            status: draft.status,
            executionStatus: draft.execution_status,
            revision: draft.revision,
          }
        : null,
    };
  }
  async getSave(id: string) {
    return this.saveOut(await this.save(id));
  }
  async saves(query: { limit?: number; cursor?: string } = {}) {
    const limit = query.limit ?? 25;
    let boundary: [string, string] | null = null;
    if (query.cursor) {
      try {
        const v: unknown = JSON.parse(atob(query.cursor));
        if (
          Array.isArray(v) &&
          v.length === 2 &&
          v.every((x) => typeof x === "string")
        )
          boundary = v as [string, string];
        else throw new Error();
      } catch {
        throw new DomainError("invalid_cursor", 400);
      }
    }
    // Creation ordering stays stable when notes/status are edited between pages.
    const rows = await this.db
      .prepare(
        `SELECT s.*,j.title AS job_title,j.company AS job_company,d.id AS draft_id,d.status AS draft_status,d.execution_status AS draft_execution_status,d.revision AS draft_revision FROM saved_jobs s JOIN jobs j ON j.id=s.job_id LEFT JOIN draft_applications d ON d.id=(SELECT latest.id FROM draft_applications latest WHERE latest.saved_job_id=s.id AND latest.user_id=s.user_id ORDER BY latest.updated_at DESC,latest.id DESC LIMIT 1) WHERE s.user_id=? ${boundary ? "AND (s.created_at < ? OR (s.created_at = ? AND s.id < ?))" : ""} ORDER BY s.created_at DESC,s.id DESC LIMIT ?`,
      )
      .bind(
        this.actor.id,
        ...(boundary ? [boundary[0], boundary[0], boundary[1]] : []),
        limit + 1,
      )
      .all<
        Save & {
          job_title: string;
          job_company: string | null;
          draft_id: string | null;
          draft_status: string | null;
          draft_execution_status: string;
          draft_revision: number;
        }
      >();
    const page = rows.results.slice(0, limit),
      last = page.at(-1);
    return {
      items: await Promise.all(
        page.map((r) =>
          this.saveOut(
            r,
            r.draft_id
              ? {
                  id: r.draft_id,
                  status: r.draft_status,
                  execution_status: r.draft_execution_status,
                  revision: r.draft_revision,
                }
              : null,
            { title: r.job_title, company: r.job_company },
          ),
        ),
      ),
      nextCursor:
        rows.results.length > limit && last
          ? btoa(JSON.stringify([last.created_at, last.id]))
          : null,
    };
  }
  async createSave(jobId: string) {
    const job = await this.job(jobId),
      id = uid(),
      stamp = now();
    await this.db.batch([
      this.db
        .prepare(
          "INSERT INTO saved_jobs(id,user_id,job_id,status,created_at,updated_at) VALUES(?,?,?,'Saved',?,?) ON CONFLICT(user_id,job_id) DO NOTHING",
        )
        .bind(id, this.actor.id, job.id, stamp, stamp),
      this.conditionalAudit("create", "saved_job", id, 1),
    ]);
    const row = await this.db
      .prepare("SELECT * FROM saved_jobs WHERE user_id=? AND job_id=?")
      .bind(this.actor.id, job.id)
      .first<Save>();
    if (!row) throw new Error("save_missing");
    return this.saveOut(row);
  }
  async editSave(id: string, input: z.infer<typeof savePatchSchema>) {
    const s = await this.save(id);
    id = s.id;
    if (s.revision !== input.expectedRevision)
      throw new DomainError("revision_conflict", 409);
    if (input.status && !canTransition(s.status, input.status))
      throw new DomainError("invalid_status_transition", 409);
    const result = await this.db.batch([
      this.db
        .prepare(
          "UPDATE saved_jobs SET notes=?,priority=?,status=?,outcome_notes=?,submission_url=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=? AND revision=?",
        )
        .bind(
          input.notes === undefined ? s.notes : input.notes,
          input.priority === undefined ? s.priority : input.priority,
          input.status ?? s.status,
          input.outcomeNotes === undefined
            ? s.outcome_notes
            : input.outcomeNotes,
          input.submissionUrl === undefined
            ? s.submission_url
            : input.submissionUrl,
          now(),
          id,
          this.actor.id,
          input.expectedRevision,
        ),
      this.conditionalAudit(
        "edit",
        "saved_job",
        id,
        input.expectedRevision + 1,
      ),
    ]);
    if (!result[0].meta.changes)
      throw new DomainError("revision_conflict", 409);
    return this.getSave(id);
  }
  async draft(id: string) {
    const d = await this.db
      .prepare("SELECT * FROM draft_applications WHERE id=? AND user_id=?")
      .bind(id, this.actor.id)
      .first<Draft>();
    if (!d) throw new DomainError("not_found", 404);
    return d;
  }
  async getDraft(id: string) {
    const d = await this.draft(id);
    return {
      id: d.id,
      savedJobId: d.saved_job_id,
      revision: d.revision,
      status: d.status,
      executionStatus: d.execution_status,
      coverLetter: d.cover_letter,
      shortAnswers: d.short_answers,
      reviewerNotes: d.reviewer_notes,
      approvedRevision: d.approved_revision,
      provenance: d.provenance,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
    };
  }
  async editDraft(
    id: string,
    input: z.infer<typeof draftPatchSchema>,
    approve = false,
  ) {
    const d = await this.draft(id);
    if (d.revision !== input.expectedRevision)
      throw new DomainError("revision_conflict", 409);
    if (
      ["queued", "running"].includes(d.execution_status) &&
      d.provenance !== "generation"
    )
      throw new DomainError("draft_busy", 409);
    if (
      approve &&
      (!["Ready for Review", "Needs Edits"].includes(d.status ?? "") ||
        !(d.cover_letter?.trim() || d.short_answers?.trim()))
    )
      throw new DomainError("draft_not_approvable", 409);
    const stamp = now(),
      next = input.expectedRevision + 1;
    const result = await this.db.batch([
      this.db
        .prepare(
          "UPDATE draft_applications SET cover_letter=?,short_answers=?,reviewer_notes=?,status=?,approved_revision=?,execution_status=CASE WHEN provenance='generation' AND execution_status IN ('queued','running') THEN 'cancelled' ELSE execution_status END,revision=revision+1,updated_at=? WHERE id=? AND user_id=? AND revision=?",
        )
        .bind(
          input.coverLetter === undefined ? d.cover_letter : input.coverLetter,
          input.shortAnswers === undefined
            ? d.short_answers
            : input.shortAnswers,
          input.reviewerNotes === undefined
            ? d.reviewer_notes
            : input.reviewerNotes,
          approve ? "Approved" : "Needs Edits",
          approve ? next : d.approved_revision,
          stamp,
          id,
          this.actor.id,
          input.expectedRevision,
        ),
      this.db
        .prepare(
          "INSERT INTO draft_versions(id,draft_id,user_id,revision,cover_letter,short_answers,reviewer_notes,status,created_at) SELECT ?,id,user_id,revision,cover_letter,short_answers,reviewer_notes,status,? FROM draft_applications WHERE id=? AND user_id=? AND changes()=1",
        )
        .bind(uid(), stamp, id, this.actor.id),
      this.conditionalAudit(approve ? "approve" : "edit", "draft", id, next),
    ]);
    if (!result[0].meta.changes)
      throw new DomainError("revision_conflict", 409);
    return this.getDraft(id);
  }
  async dashboard(query: { limit?: number; cursor?: string } = {}) {
    const saves = await this.saves(query);
    const counts = await this.db
      .prepare(
        "SELECT status,COUNT(*) AS count FROM saved_jobs WHERE user_id=? GROUP BY status",
      )
      .bind(this.actor.id)
      .all<{ status: string | null; count: number }>();
    const profiles = await this.db
      .prepare(
        "SELECT COUNT(*) AS count FROM candidate_profiles WHERE user_id=? AND archived_at IS NULL",
      )
      .bind(this.actor.id)
      .first<{ count: number }>();
    return {
      savedJobs: saves.items,
      nextCursor: saves.nextCursor,
      counts: {
        savedJobs: counts.results.reduce((a, r) => a + r.count, 0),
        profiles: profiles?.count ?? 0,
        byStatus: counts.results,
      },
    };
  }
}
function jobOut(j: Job) {
  return {
    id: j.id,
    legacyId: j.legacy_id,
    title: j.title,
    company: j.company,
    location: j.location,
    remote: j.remote,
    employment: j.employment,
    seniority: j.seniority,
    sourceUrl: safeUrl(j.source_url),
    description: j.description,
    status: j.status,
    createdAt: j.created_at,
  };
}
export async function initializeActor(
  db: D1Database,
  user: { id: string; email: string; name: string },
): Promise<Actor> {
  // New account gets a new empty business user. No legacy lookup by email.
  const id = uid(),
    stamp = now();
  await db.batch([
    db
      .prepare(
        "INSERT INTO users(id,email,name,created_at,updated_at) SELECT ?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM auth_identities WHERE issuer='email-password' AND subject=?)",
      )
      .bind(id, user.email, user.name, stamp, stamp, user.id),
    db
      .prepare(
        "INSERT INTO auth_identities(issuer,subject,user_id,created_at) VALUES('email-password',?,?,?) ON CONFLICT(issuer,subject) DO NOTHING",
      )
      .bind(user.id, id, stamp),
  ]);
  const identity = await db
    .prepare(
      "SELECT user_id FROM auth_identities WHERE issuer='email-password' AND subject=?",
    )
    .bind(user.id)
    .first<{ user_id: string }>();
  if (!identity) throw new Error("identity_missing");
  return { id: identity.user_id, email: user.email, name: user.name };
}
