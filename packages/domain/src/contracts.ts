import { z } from "zod";
export const idSchema = z.string().min(1).max(200);
export const revisionSchema = z.number().int().positive();
export const safeUrlSchema = z
  .url()
  .max(4096)
  .refine((value) => {
    const u = new URL(value);
    return (
      ["http:", "https:"].includes(u.protocol) && !u.username && !u.password
    );
  }, "Use a public HTTP(S) URL");
export function safeUrl(value: string | null): string | null {
  const result = safeUrlSchema.safeParse(value);
  return result.success ? result.data : null;
}
export const profileContentSchema = z.strictObject({
  headline: z.string().max(300).optional(),
  summary: z.string().max(20000).optional(),
  skills: z.array(z.string().max(200)).max(100).optional(),
  experience: z.string().max(50000).optional(),
  education: z.string().max(20000).optional(),
  preferences: z.string().max(10000).optional(),
  email: z.email().max(320).nullable().optional(),
  location: z.string().max(500).nullable().optional(),
  targetRoles: z.array(z.string().max(200)).max(100).optional(),
  yearsOfExperience: z.number().min(0).max(100).nullable().optional(),
  portfolioUrl: safeUrlSchema.nullable().optional(),
  linkedinUrl: safeUrlSchema.nullable().optional(),
  githubUrl: safeUrlSchema.nullable().optional(),
  preferredWorkType: z.string().max(100).nullable().optional(),
  preferredEmploymentType: z.string().max(100).nullable().optional(),
  salaryMinimum: z.number().min(0).max(1000000000).nullable().optional(),
});
export const profileCreateSchema = z.strictObject({
  idempotencyKey: z.string().min(1).max(100).optional(),
  name: z.string().trim().min(1).max(200),
  content: profileContentSchema,
});
export const profilePatchSchema = z
  .strictObject({
    expectedRevision: revisionSchema,
    name: z.string().trim().min(1).max(200).optional(),
    content: profileContentSchema.optional(),
  })
  .refine(
    (v) => v.name !== undefined || v.content !== undefined,
    "Supply a change",
  );
export const saveCreateSchema = z.strictObject({ jobId: idSchema });
export const savedLabels = [
  "Saved",
  "Draft Requested",
  "Draft Ready",
  "Submitted",
  "Rejected",
  "Offer",
  "Archived",
] as const;
export type SavedLabel = (typeof savedLabels)[number];
export const savePatchSchema = z
  .strictObject({
    expectedRevision: revisionSchema,
    notes: z.string().max(20000).nullable().optional(),
    priority: z.enum(["Low", "Medium", "High"]).nullable().optional(),
    status: z.enum(savedLabels).optional(),
    outcomeNotes: z.string().max(20000).nullable().optional(),
    submissionUrl: safeUrlSchema.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 1, "Supply a change");
export const draftPatchSchema = z
  .strictObject({
    expectedRevision: revisionSchema,
    coverLetter: z.string().max(100000).nullable().optional(),
    shortAnswers: z.string().max(50000).nullable().optional(),
    reviewerNotes: z.string().max(20000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 1, "Supply a change");
export const approvalSchema = z.strictObject({
  expectedRevision: revisionSchema,
});
export const jobQuerySchema = z.strictObject({
  status: z.enum(["Open", "Closed"]).optional(),
  q: z.string().max(200).optional(),
  remote: z.string().max(50).optional(),
  employment: z.string().max(100).optional(),
  seniority: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(1000).optional(),
});
const transitions: Record<SavedLabel, readonly SavedLabel[]> = {
  Saved: ["Archived", "Submitted"],
  "Draft Requested": ["Saved", "Archived"],
  "Draft Ready": ["Saved", "Submitted", "Archived"],
  Submitted: ["Rejected", "Offer", "Archived"],
  Rejected: ["Saved", "Archived"],
  Offer: ["Archived"],
  Archived: ["Saved"],
};
export function canTransition(from: SavedLabel | null, to: SavedLabel) {
  return (
    from === to ||
    (from === null ? to === "Saved" : transitions[from].includes(to))
  );
}
export class DomainError extends Error {
  constructor(
    public code: string,
    public status: 400 | 401 | 403 | 404 | 409 | 413 | 503,
  ) {
    super(code);
  }
}

export const pageQuerySchema = jobQuerySchema.pick({
  limit: true,
  cursor: true,
});
export const archiveSchema = approvalSchema.extend({ archived: z.boolean() });
