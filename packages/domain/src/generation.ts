import { z } from "zod";
import {
  DomainError,
  idSchema,
  profileContentSchema,
  revisionSchema,
} from "./contracts";
export const MODEL = "claude-opus-5";
export const CONTRACT = "extractive-letter-v1";
export const MAX_INPUT_BYTES = 96000;
export const MAX_EVIDENCE_CHARACTERS = 6000;
export const generationSchema = z
  .strictObject({
    savedJobId: idSchema,
    profileId: idSchema,
    profileVersionId: idSchema,
    jobVersionId: idSchema,
    resumeId: idSchema.optional(),
    idempotencyKey: z.string().min(1).max(100),
    draftId: idSchema.optional(),
    expectedRevision: revisionSchema.optional(),
  })
  .refine((v) => !!v.draftId === !!v.expectedRevision);
export type GenerationInput = z.infer<typeof generationSchema>;
export type Evidence = { id: string; text: string; source: "user-provided" };
export type Snapshot = {
  contract: string;
  job: Record<string, string>;
  evidence: Evidence[];
  gaps: string[];
  resumeContentsUsed: false;
};
export async function sha256(value: string | ArrayBuffer) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        typeof value === "string" ? new TextEncoder().encode(value) : value,
      ),
    ),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
}
export function buildSnapshot(profileJson: string, jobJson: string): Snapshot {
  const parsed: unknown = JSON.parse(profileJson);
  // Upload adds attachment IDs outside editable profile schema; retain only for parent checks elsewhere.
  const p = z.record(z.string(), z.unknown()).parse(parsed);
  const content = { ...p };
  delete content.attachmentIds;
  const result = profileContentSchema.safeParse(content);
  if (!result.success)
    throw new DomainError("profile_content_unsupported", 409);
  const profile = result.data,
    evidence: Evidence[] = [],
    omittedFields: string[] = [];
  for (const field of [
    "headline",
    "summary",
    "experience",
    "education",
  ] as const) {
    const value = profile[field]?.trim();
    if (value && value.length > MAX_EVIDENCE_CHARACTERS) {
      omittedFields.push(field);
      continue;
    }
    if (value)
      evidence.push({
        id: "profile." + field,
        text: value,
        source: "user-provided",
      });
  }
  for (const [i, skill] of (profile.skills ?? []).entries())
    if (skill.trim())
      evidence.push({
        id: "profile.skills." + i,
        text: skill.trim(),
        source: "user-provided",
      });
  if (!evidence.length)
    throw new DomainError(
      omittedFields.length
        ? "profile_evidence_too_long"
        : "profile_evidence_required",
      409,
    );
  const archive = z.record(z.string(), z.unknown()).parse(JSON.parse(jobJson));
  const core = z.record(z.string(), z.unknown()).parse(archive.core ?? archive);
  const job: Record<string, string> = {};
  for (const field of [
    "title",
    "company",
    "description",
    "location",
    "remote",
    "employment",
    "seniority",
  ]) {
    const value = core[field];
    if (typeof value === "string" && value.trim()) job[field] = value;
  }
  if (!job.title) throw new DomainError("job_content_unsupported", 409);
  const gaps = [
    "Verify that the selected profile claims are accurate and relevant to this listing.",
    ...omittedFields.map(
      (field) =>
        `The ${field} field was omitted because it exceeds 6,000 characters. Shorten it and choose the new profile version to include it; no text was truncated.`,
    ),
  ];
  if (!profile.experience?.trim())
    gaps.push(
      "Which experience examples would you like to add? No experience evidence was supplied.",
    );
  if (!profile.education?.trim())
    gaps.push(
      "Is any education or credential evidence relevant to this role? None was supplied.",
    );
  if (!profile.skills?.some((s) => s.trim()))
    gaps.push(
      "Which skills would you like to document? No skills evidence was supplied.",
    );
  const snapshot: Snapshot = {
    contract: CONTRACT,
    job,
    evidence,
    gaps,
    resumeContentsUsed: false,
  };
  if (
    new TextEncoder().encode(JSON.stringify(snapshot)).byteLength >
    MAX_INPUT_BYTES
  )
    throw new DomainError("generation_input_too_large", 413);
  return snapshot;
}
export const outputSchema = z.strictObject({
  evidenceIds: z.array(z.string().max(100)).min(1).max(8),
});
export function renderOutput(raw: unknown, snapshot: Snapshot) {
  const result = outputSchema.safeParse(raw);
  if (!result.success) throw new DomainError("provider_output_invalid", 409);
  if (new Set(result.data.evidenceIds).size !== result.data.evidenceIds.length)
    throw new DomainError("provider_output_unsupported", 409);
  const evidence = result.data.evidenceIds.map((id) => {
    const e = snapshot.evidence.find((v) => v.id === id);
    if (!e || e.text.length > MAX_EVIDENCE_CHARACTERS)
      throw new DomainError("provider_output_unsupported", 409);
    return e;
  });
  // No free-form model prose is accepted. Exact quotations preserve attribution,
  // including numbers/employers/credentials; those claims remain unverified.
  const coverLetter = [
    "Dear hiring team,",
    "I would like to express my interest in the advertised role.",
    "I offer the following statements from my profile for your consideration:",
    ...evidence.map((e) => "“" + e.text + "”"),
    "Thank you for considering my application.",
  ].join("\n\n");
  return {
    coverLetter,
    evidence,
    gaps: snapshot.gaps,
    reviewRequired: true,
    validation: "exact-user-evidence-only",
    resumeContentsUsed: false,
    reviewNote:
      "These are unverified user-provided claims, selected by a model. Review accuracy, relevance, quotation context and tone before approving. No employer screening questions were supplied or generated.",
  };
}
