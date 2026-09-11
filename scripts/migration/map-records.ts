import {
  recordHash,
  validateExport,
  type SourceExport,
  type Issue,
} from "./validate-export.ts";
import type { Manifest } from "./copy-attachments.ts";
export type SqlValue = string | number | null;
export type MappedRecord = {
  table: string;
  sourceTable: string;
  sourceId: string;
  id: string;
  core: Record<string, SqlValue>;
  fields: Record<string, unknown>;
  sourceHash: string;
  sourceCreatedAt: string;
  sourceUpdatedAt: string;
  version?: Record<string, unknown>;
};
export const legacyId = (tableId: string, sourceId: string) =>
  "legacy_" + recordHash([tableId, sourceId]).slice(0, 32);
function refs(value: unknown): string[] {
  return (Array.isArray(value) ? value : value ? [value] : []).flatMap((x) =>
    typeof x === "string"
      ? [x]
      : x && typeof x === "object" && "id" in x && typeof x.id === "string"
        ? [x.id]
        : [],
  );
}
function select(value: unknown): unknown {
  return value && typeof value === "object" && "label" in value
    ? value.label
    : value;
}
function text(value: unknown): string | null {
  const v = select(value);
  return typeof v === "string" && v !== "" ? v : null;
}
function list(value: unknown): string[] {
  return (Array.isArray(value) ? value : value ? [value] : []).flatMap(
    (v) => text(v) ?? [],
  );
}
function number(value: unknown): number | null {
  if (
    value === null ||
    value === undefined ||
    value === "" ||
    (typeof value !== "number" && typeof value !== "string")
  )
    return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
export function mapRecords(source: SourceExport, files: Manifest) {
  const validation = validateExport(source);
  const issues: Issue[] = [...validation.issues];
  if (files.sourceHash !== recordHash(source))
    issues.push({ code: "ATTACHMENT_MANIFEST_MISMATCH" });
  const result = {
    issues,
    sourceHash: "",
    users: [] as MappedRecord[],
    profiles: [] as MappedRecord[],
    jobs: [] as MappedRecord[],
    savedJobs: [] as MappedRecord[],
    drafts: [] as MappedRecord[],
    attachments: [] as MappedRecord[],
  };
  if (issues.length) return result;
  const tableIds = Object.fromEntries(source.tables.map((t) => [t.name, t.id]));
  const fileIndex = new Map(
    files.attachments.map((file) => [file.referenceId, file]),
  );
  const targets: Record<
    string,
    [
      keyof Pick<
        typeof result,
        "users" | "profiles" | "jobs" | "savedJobs" | "drafts"
      >,
      string,
    ]
  > = {
    Users: ["users", "users"],
    "Candidate Profile": ["profiles", "candidate_profiles"],
    "Job Listings": ["jobs", "jobs"],
    "Saved Jobs": ["savedJobs", "saved_jobs"],
    "Draft Applications": ["drafts", "draft_applications"],
  };
  for (const table of source.tables) {
    const target = targets[table.name];
    if (!target) {
      issues.push({ code: "UNMAPPED_TABLE", table: table.name });
      continue;
    }
    for (const row of table.records) {
      const id = legacyId(table.id, row.id);
      const get = (name: string) =>
        row.fields[table.fields.find((f) => f.name === name)?.id ?? ""];
      const ownerSourceId =
        table.name === "Users"
          ? row.id
          : refs(get(table.name === "Candidate Profile" ? "Owner" : "User"))[0];
      const ownerId = ownerSourceId
        ? legacyId(tableIds.Users!, ownerSourceId)
        : null;
      const fields = structuredClone(row.fields);
      const attachmentReferences: Record<string, string[]> = {};
      for (const field of table.fields.filter((f) => f.type === "ATTACHMENT")) {
        const raw = row.fields[field.id];
        const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
        const sanitized: Record<string, unknown>[] = [];
        for (const [index, value] of values.entries()) {
          const a =
            value && typeof value === "object"
              ? (value as Record<string, unknown>)
              : {};
          const referenceId = recordHash([
            table.id,
            row.id,
            field.id,
            a.id ?? null,
            index,
          ]);
          const file = fileIndex.get(referenceId);
          if (
            !file ||
            file.ownerIds.length !== 1 ||
            file.ownerIds[0] !== ownerSourceId
          ) {
            issues.push({
              code: "ATTACHMENT_OWNER_OR_REFERENCE_INVALID",
              table: table.name,
              recordId: row.id,
              fieldId: field.id,
            });
            continue;
          }
          const attachmentId = legacyId("attachments", referenceId);
          const safeMetadata = {
            id: a.id ?? null,
            attachmentId,
            filename: a.filename ?? null,
            type: a.type ?? null,
            size: a.size ?? null,
            sha256: file.sha256 ?? null,
          };
          sanitized.push(safeMetadata);
          (attachmentReferences[field.name] ??= []).push(attachmentId);
          const core: Record<string, SqlValue> = {
            id: attachmentId,
            user_id: ownerId,
            profile_id: table.name === "Candidate Profile" ? id : null,
            draft_id: table.name === "Draft Applications" ? id : null,
            object_key: file.sha256
              ? "quarantine/" + ownerId + "/" + attachmentId + "/" + file.sha256
              : null,
            filename: text(a.filename),
            media_type: file.detectedType ?? text(a.type),
            size_bytes: file.bytes ?? null,
            checksum_sha256: file.sha256 ?? null,
            status:
              file.state === "downloaded-quarantined" ? "pending" : "missing",
            scan_status: "pending",
            source_created_at: row.createdAt,
            source_updated_at: row.updatedAt,
            legacy_id: referenceId,
          };
          result.attachments.push({
            table: "attachments",
            sourceTable: "attachment:" + table.id + ":" + field.id,
            sourceId: referenceId,
            id: attachmentId,
            core,
            fields: safeMetadata,
            sourceHash: recordHash({ core, fields: safeMetadata }),
            sourceCreatedAt: row.createdAt,
            sourceUpdatedAt: row.updatedAt,
          });
          if (
            file.state !== "downloaded-quarantined" ||
            !file.sha256 ||
            !file.sizeMatches ||
            !file.typeMatches
          )
            issues.push({
              code: "ATTACHMENT_UNAVAILABLE_OR_MISMATCH",
              table: table.name,
              recordId: row.id,
              fieldId: field.id,
            });
        }
        fields[field.id] = Array.isArray(raw)
          ? sanitized
          : (sanitized[0] ?? null);
      }
      const core: Record<string, SqlValue> = {
        id,
        legacy_id: row.id,
        source_created_at: row.createdAt,
        source_updated_at: row.updatedAt,
      };
      let version: Record<string, unknown> | undefined;
      if (table.name === "Users")
        Object.assign(core, {
          email: text(get("Email")),
          name: text(get("Name")),
        });
      if (table.name === "Candidate Profile") {
        const content = {
          email: text(get("Email")),
          headline: text(get("Headline")),
          location: text(get("Location")),
          targetRoles: list(get("Target Roles")),
          skills: list(get("Skills")),
          yearsOfExperience: number(get("Years of Experience")),
          portfolioUrl: text(get("Portfolio URL")),
          linkedinUrl: text(get("LinkedIn URL")),
          githubUrl: text(get("GitHub URL")),
          summary: text(get("Summary")),
          preferredWorkType: text(get("Preferred Work Type")),
          preferredEmploymentType: text(get("Preferred Employment Type")),
          salaryMinimum: number(get("Salary Minimum")),
          salaryCurrency: text(get("Salary Currency")),
          attachmentReferences,
          sourceBusinessCreatedAt: text(get("Created At")),
          sourceBusinessUpdatedAt: text(get("Updated At")),
        };
        Object.assign(core, {
          user_id: ownerId,
          name: text(get("Full Name")) ?? "",
          content_json: JSON.stringify(content),
        });
        version = content;
      }
      if (table.name === "Job Listings") {
        Object.assign(core, {
          title: text(get("Job Title")) ?? "",
          company: text(get("Company")),
          location: text(get("Location")),
          remote: text(get("Remote Policy")),
          employment: text(get("Employment Type")),
          seniority: text(get("Seniority")),
          source_url: text(get("Source Job URL")),
          description: text(get("Description")),
          status: text(get("Job Status")),
        });
        version = {
          ...core,
          source: text(get("Source")),
          externalId: text(get("External ID")),
          salaryMinimum: number(get("Salary Range Min")),
          salaryMaximum: number(get("Salary Range Max")),
          salaryCurrency: text(get("Salary Currency")),
          salaryPeriod: text(get("Salary Period")),
          requirements: text(get("Requirements")),
          tags: list(get("Tags")),
          requiredSkills: list(get("Required Skills")),
          companySize: text(get("Company Size")),
          postedDate: text(get("Posted Date")),
          lastSeenAt: text(get("Last Seen At")),
          sourceBusinessCreatedAt: text(get("Created At")),
          sourceBusinessUpdatedAt: text(get("Updated At")),
        };
      }
      if (table.name === "Saved Jobs")
        Object.assign(core, {
          user_id: ownerId,
          job_id: legacyId(tableIds["Job Listings"]!, refs(get("Job"))[0]!),
          notes: text(get("Notes")),
          priority: text(get("Priority")),
          status: text(get("Status")),
          outcome_notes: text(get("Outcome Notes")),
          submission_url: text(get("External Submission URL")),
        });
      if (table.name === "Draft Applications")
        Object.assign(core, {
          user_id: ownerId,
          saved_job_id: legacyId(
            tableIds["Saved Jobs"]!,
            refs(get("Saved Job"))[0]!,
          ),
          profile_id: null,
          profile_version_id: null,
          status: text(get("Draft Status")),
          execution_status: "legacy",
          cover_letter: text(get("Cover Letter")),
          short_answers: text(get("Short Answers")),
          reviewer_notes: text(get("Reviewer Notes")),
          approved_revision:
            text(get("Draft Status")) === "Approved" ? 1 : null,
          provenance: "legacy",
        });
      result[target[0]].push({
        table: target[1],
        sourceTable: table.id,
        sourceId: row.id,
        id,
        core,
        fields,
        sourceHash: recordHash({
          id: row.id,
          fields,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        }),
        sourceCreatedAt: row.createdAt,
        sourceUpdatedAt: row.updatedAt,
        version,
      });
    }
  }
  // Signed download URLs and capture timestamps do not create target versions on a repeated capture.
  result.sourceHash = recordHash({
    schemas: source.tables.map((t) => ({ id: t.id, fields: t.fields })),
    records: [
      ...result.users,
      ...result.profiles,
      ...result.jobs,
      ...result.savedJobs,
      ...result.drafts,
      ...result.attachments,
    ].map((r) => [r.sourceTable, r.sourceId, r.sourceHash]),
    authRoster: source.authRoster,
  });
  return result;
}
