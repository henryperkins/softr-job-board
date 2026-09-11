import { z } from "zod";
import { idSchema, pageQuerySchema, profileContentSchema } from "./contracts";

// One source of truth for the capabilities an MCP client can hold. The consent
// screen, the authorization-server metadata and every tool guard read these, so
// a client can never be granted a capability the consent screen did not name.
export const MCP_SCOPES = {
  read: "app:read",
  write: "app:write",
  generate: "drafts:generate",
  review: "drafts:review",
} as const;
export type McpScope = (typeof MCP_SCOPES)[keyof typeof MCP_SCOPES];

// offline_access is the only internally supported scope we advertise. "openid"
// is deliberately absent: this is an OAuth 2.1 resource server, not an OIDC
// provider, and opaque access tokens make HS256 id tokens useless to a public
// PKCE client anyway.
export const MCP_ADVERTISED_SCOPES: readonly string[] = [
  "offline_access",
  MCP_SCOPES.read,
  MCP_SCOPES.write,
  MCP_SCOPES.generate,
  MCP_SCOPES.review,
];

export const MCP_SCOPE_DESCRIPTIONS: Record<string, string> = {
  offline_access:
    "Stay connected without asking you to sign in again until you revoke access.",
  [MCP_SCOPES.read]:
    "Read your job board: job postings, your profiles, your saved jobs and your drafts.",
  [MCP_SCOPES.write]:
    "Create and change your profiles, saved jobs and draft text. It cannot approve a draft.",
  [MCP_SCOPES.generate]:
    "Request a draft to be generated from a profile version you choose. It cannot approve the result.",
  [MCP_SCOPES.review]:
    "Mark one of your drafts approved at a revision you name.",
};

export function describeScope(scope: string) {
  return MCP_SCOPE_DESCRIPTIONS[scope] ?? "Unrecognized access.";
}

// Every tool input is a strict object: an unknown key is rejected rather than
// ignored, so userId/owner/model/endpoint injection fails closed instead of
// being silently dropped.
const cursorInput = pageQuerySchema.extend({
  limit: z.number().int().min(1).max(100).default(25),
});

export const mcpToolSchemas = {
  list_jobs: z.strictObject({
    query: z.string().max(200).optional(),
    status: z.enum(["Open", "Closed"]).optional(),
    remote: z.string().max(50).optional(),
    employment: z.string().max(100).optional(),
    seniority: z.string().max(100).optional(),
    limit: z.number().int().min(1).max(100).default(25),
    cursor: z.string().max(1000).optional(),
  }),
  get_job: z.strictObject({ jobId: idSchema }),
  list_profiles: z.strictObject({}),
  get_profile: z.strictObject({ profileId: idSchema }),
  create_profile: z.strictObject({
    idempotencyKey: z.string().min(1).max(100),
    name: z.string().trim().min(1).max(200),
    content: profileContentSchema,
  }),
  update_profile: z.strictObject({
    profileId: idSchema,
    expectedRevision: z.number().int().positive(),
    name: z.string().trim().min(1).max(200).optional(),
    // Supplied fields are merged over the stored content by the shared service.
    // Unmentioned fields are preserved, never blanked.
    content: profileContentSchema.optional(),
  }),
  activate_profile: z.strictObject({ profileId: idSchema }),
  list_saved_jobs: cursorInput,
  get_saved_job: z.strictObject({ savedJobId: idSchema }),
  save_job: z.strictObject({ jobId: idSchema }),
  update_saved_job: z.strictObject({
    savedJobId: idSchema,
    expectedRevision: z.number().int().positive(),
    notes: z.string().max(20000).nullable().optional(),
    priority: z.enum(["Low", "Medium", "High"]).nullable().optional(),
    status: z
      .enum([
        "Saved",
        "Draft Requested",
        "Draft Ready",
        "Submitted",
        "Rejected",
        "Offer",
        "Archived",
      ])
      .optional(),
    outcomeNotes: z.string().max(20000).nullable().optional(),
  }),
  get_draft: z.strictObject({ draftId: idSchema }),
  list_drafts: z.strictObject({ savedJobId: idSchema }),
  update_draft: z.strictObject({
    draftId: idSchema,
    expectedRevision: z.number().int().positive(),
    coverLetter: z.string().max(100000).nullable().optional(),
    shortAnswers: z.string().max(50000).nullable().optional(),
    reviewerNotes: z.string().max(20000).nullable().optional(),
  }),
  approve_draft: z.strictObject({
    draftId: idSchema,
    expectedRevision: z.number().int().positive(),
  }),
  request_draft_generation: z.strictObject({
    idempotencyKey: z.string().min(1).max(100),
    savedJobId: idSchema,
    profileId: idSchema,
    profileVersionId: idSchema,
    jobVersionId: idSchema,
    draftId: idSchema.optional(),
    expectedRevision: z.number().int().positive().optional(),
  }),
  get_generation_request: z.strictObject({ requestId: idSchema }),
  get_generation_options: z.strictObject({ savedJobId: idSchema }),
} as const;

export type McpToolName = keyof typeof mcpToolSchemas;

// readOnly/idempotent/destructive are advertised hints for clients. They are
// never the authorization decision: `scope` below is enforced server side.
export const mcpToolMeta: Record<
  McpToolName,
  {
    scope: McpScope;
    title: string;
    description: string;
    readOnly: boolean;
    idempotent: boolean;
  }
> = {
  list_jobs: {
    scope: MCP_SCOPES.read,
    title: "List job postings",
    description:
      "Search and page the shared job catalog. Returns a bounded page and an opaque cursor.",
    readOnly: true,
    idempotent: true,
  },
  get_job: {
    scope: MCP_SCOPES.read,
    title: "Get a job posting",
    description: "Read one job posting by its id or its legacy id.",
    readOnly: true,
    idempotent: true,
  },
  list_profiles: {
    scope: MCP_SCOPES.read,
    title: "List your profiles",
    description:
      "List the signed-in user's candidate profiles and which one is active.",
    readOnly: true,
    idempotent: true,
  },
  get_profile: {
    scope: MCP_SCOPES.read,
    title: "Get a profile",
    description: "Read one of the signed-in user's profiles.",
    readOnly: true,
    idempotent: true,
  },
  create_profile: {
    scope: MCP_SCOPES.write,
    title: "Create a profile",
    description:
      "Create a candidate profile. Requires an idempotency key; repeating the same key returns the same profile instead of creating another.",
    readOnly: false,
    idempotent: true,
  },
  update_profile: {
    scope: MCP_SCOPES.write,
    title: "Update a profile",
    description:
      "Merge changes into a profile at an expected revision. Fields you omit keep their stored values.",
    readOnly: false,
    idempotent: false,
  },
  activate_profile: {
    scope: MCP_SCOPES.write,
    title: "Choose the active profile",
    description: "Make one profile the active one for generation.",
    readOnly: false,
    idempotent: true,
  },
  list_saved_jobs: {
    scope: MCP_SCOPES.read,
    title: "List your saved jobs",
    description: "Page the signed-in user's saved jobs.",
    readOnly: true,
    idempotent: true,
  },
  get_saved_job: {
    scope: MCP_SCOPES.read,
    title: "Get a saved job",
    description: "Read one saved job and its latest draft summary.",
    readOnly: true,
    idempotent: true,
  },
  save_job: {
    scope: MCP_SCOPES.write,
    title: "Save a job",
    description:
      "Save a job for the signed-in user. Saving an already saved job returns the existing record.",
    readOnly: false,
    idempotent: true,
  },
  update_saved_job: {
    scope: MCP_SCOPES.write,
    title: "Update a saved job",
    description:
      "Change notes, priority, status or outcome notes at an expected revision.",
    readOnly: false,
    idempotent: false,
  },
  get_draft: {
    scope: MCP_SCOPES.read,
    title: "Get a draft",
    description: "Read one of the signed-in user's drafts.",
    readOnly: true,
    idempotent: true,
  },
  list_drafts: {
    scope: MCP_SCOPES.read,
    title: "List drafts for a saved job",
    description: "List the drafts attached to one saved job.",
    readOnly: true,
    idempotent: true,
  },
  update_draft: {
    scope: MCP_SCOPES.write,
    title: "Edit draft text",
    description:
      "Change draft text at an expected revision. This never approves the draft.",
    readOnly: false,
    idempotent: false,
  },
  approve_draft: {
    scope: MCP_SCOPES.review,
    title: "Approve a draft",
    description:
      "Mark a draft approved at the revision you name. Requires the separate review capability.",
    readOnly: false,
    idempotent: false,
  },
  request_draft_generation: {
    scope: MCP_SCOPES.generate,
    title: "Request draft generation",
    description:
      "Queue a draft generation request against an exact profile version and job version. Returns the queued request status, never a finished draft.",
    readOnly: false,
    idempotent: true,
  },
  get_generation_request: {
    scope: MCP_SCOPES.read,
    title: "Get generation request status",
    description: "Read the authoritative status of one generation request.",
    readOnly: true,
    idempotent: true,
  },
  get_generation_options: {
    scope: MCP_SCOPES.read,
    title: "Get generation options",
    description:
      "List the profile versions and job version that a generation request for a saved job may reference.",
    readOnly: true,
    idempotent: true,
  },
};
