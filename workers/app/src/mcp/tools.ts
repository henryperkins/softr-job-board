import { McpServer } from "@modelcontextprotocol/server";
import type { z } from "zod";
import { GenerationService } from "../../../../packages/data/src/generation";
import { DomainError } from "../../../../packages/domain/src/contracts";
import type { Actor } from "../../../../packages/data/src/services";
import {
  MCP_SCOPES,
  mcpToolMeta,
  mcpToolSchemas,
  type McpToolName,
} from "../../../../packages/domain/src/mcp";
import type { AppEnv } from "../env";

export type McpGrant = { clientId: string; scopes: ReadonlySet<string> };

type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent: Record<string, unknown>;
  isError?: boolean;
};

// A tool result carries data the model may read. It is never an instruction:
// nothing downstream re-interprets this text as a command, and a tool can never
// widen the grant it was called under.
function ok(value: unknown): ToolResult {
  const structured =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : { value };
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: structured,
  };
}

// Domain failures are reported in band so a client can correct itself. Anything
// else becomes a generic internal error: raw exception text could carry stored
// record content or provider detail into a third-party client.
function fail(error: unknown): ToolResult {
  const code = error instanceof DomainError ? error.code : "internal_error";
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: code }) }],
    structuredContent: { error: code },
  };
}

export function buildMcpServer(
  env: AppEnv,
  actor: Actor,
  grant: McpGrant,
  onReject?: (
    tool: McpToolName,
    reason:
      | "insufficient_scope"
      | "writes_disabled"
      | "invalid_request"
      | "internal_error",
  ) => void,
): McpServer {
  const server = new McpServer({
    name: "softr-job-board",
    title: "Job board",
    version: "0.1.0",
  });
  const data = new GenerationService(env.DB, actor);
  const writesEnabled = env.WRITES_ENABLED === "true";
  const mcpWritesEnabled = env.MCP_WRITES_ENABLED === "true";
  const mcpGenerationEnabled = env.MCP_GENERATION_ENABLED === "true";
  const mcpReviewEnabled = env.MCP_REVIEW_ENABLED === "true";

  const register = <N extends McpToolName>(
    name: N,
    run: (
      input: ReturnType<(typeof mcpToolSchemas)[N]["parse"]>,
    ) => Promise<unknown>,
  ) => {
    const meta = mcpToolMeta[name];
    // A tool the grant does not cover is never advertised and never dispatchable.
    // Scope is re-checked inside the handler as well, so a listing bug cannot
    // become an authorization bug.
    if (!grant.scopes.has(meta.scope)) return;
    if (!meta.readOnly && !mcpWritesEnabled) return;
    if (name === "request_draft_generation" && !mcpGenerationEnabled) return;
    if (name === "approve_draft" && !mcpReviewEnabled) return;
    // Widened from the per-tool union so one registration call type-checks for
    // every tool; the exact schema is still what validates the input below.
    const inputSchema: z.ZodType = mcpToolSchemas[name];
    server.registerTool(
      name,
      {
        title: meta.title,
        description: meta.description,
        inputSchema,
        annotations: {
          title: meta.title,
          readOnlyHint: meta.readOnly,
          idempotentHint: meta.idempotent,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      async (input: unknown) => {
        try {
          if (!grant.scopes.has(meta.scope))
            throw new DomainError("insufficient_scope", 403);
          // The independent write release gate applies to MCP exactly as it
          // applies to the browser API. A granted scope is not a release.
          if (!meta.readOnly && !writesEnabled)
            throw new DomainError("writes_disabled", 503);
          const parsed = mcpToolSchemas[name].safeParse(input);
          if (!parsed.success) throw new DomainError("invalid_request", 400);
          return ok(
            await run(
              parsed.data as ReturnType<(typeof mcpToolSchemas)[N]["parse"]>,
            ),
          );
        } catch (error) {
          const reason =
            error instanceof DomainError &&
            [
              "insufficient_scope",
              "writes_disabled",
              "invalid_request",
            ].includes(error.code)
              ? (error.code as
                  "insufficient_scope" | "writes_disabled" | "invalid_request")
              : "internal_error";
          onReject?.(name, reason);
          return fail(error);
        }
      },
    );
  };

  register("list_jobs", async (i) =>
    data.jobs({
      q: i.query,
      status: i.status,
      remote: i.remote,
      employment: i.employment,
      seniority: i.seniority,
      limit: i.limit,
      cursor: i.cursor,
    }),
  );
  register("get_job", async (i) => data.job(i.jobId));
  register("list_profiles", async () => data.profiles());
  register("get_profile", async (i) => data.getProfile(i.profileId));
  register("create_profile", async (i) =>
    data.createProfile({
      idempotencyKey: i.idempotencyKey,
      name: i.name,
      content: i.content,
    }),
  );
  register("update_profile", async (i) =>
    data.editProfile(i.profileId, {
      expectedRevision: i.expectedRevision,
      name: i.name,
      content: i.content,
    }),
  );
  register("activate_profile", async (i) => data.activateProfile(i.profileId));
  register("list_saved_jobs", async (i) =>
    data.saves({ limit: i.limit, cursor: i.cursor }),
  );
  register("get_saved_job", async (i) => data.getSave(i.savedJobId));
  register("save_job", async (i) => data.createSave(i.jobId));
  register("update_saved_job", async (i) =>
    data.editSave(i.savedJobId, {
      expectedRevision: i.expectedRevision,
      notes: i.notes,
      priority: i.priority,
      status: i.status,
      outcomeNotes: i.outcomeNotes,
    }),
  );
  register("get_draft", async (i) => data.getDraft(i.draftId));
  register("list_drafts", async (i) => data.draftList(i.savedJobId));
  register("update_draft", async (i) =>
    data.editDraft(i.draftId, {
      expectedRevision: i.expectedRevision,
      coverLetter: i.coverLetter,
      shortAnswers: i.shortAnswers,
      reviewerNotes: i.reviewerNotes,
    }),
  );
  // Approval is deliberately a separate capability from editing, and it reuses
  // the same explicit-revision approval path the browser uses.
  register("approve_draft", async (i) =>
    data.editDraft(i.draftId, { expectedRevision: i.expectedRevision }, true),
  );
  register("get_generation_options", async (i) => ({
    ...(await data.options(i.savedJobId)),
    enabled:
      env.GENERATION_ENABLED === "true" &&
      env.WRITES_ENABLED === "true" &&
      mcpGenerationEnabled &&
      mcpWritesEnabled,
  }));
  register("get_generation_request", async (i) => data.status(i.requestId));
  register("request_draft_generation", async (i) => {
    // Returns the queued request, never a finished draft: the provider call
    // happens later in the background worker, behind its own release gate.
    const status = await data.request(
      {
        idempotencyKey: i.idempotencyKey,
        savedJobId: i.savedJobId,
        profileId: i.profileId,
        profileVersionId: i.profileVersionId,
        jobVersionId: i.jobVersionId,
        ...(i.draftId ? { draftId: i.draftId } : {}),
        ...(i.expectedRevision ? { expectedRevision: i.expectedRevision } : {}),
      },
      {
        enabled:
          env.GENERATION_ENABLED === "true" &&
          mcpGenerationEnabled &&
          mcpWritesEnabled,
        dailyLimit: Number(env.GENERATION_DAILY_LIMIT),
        inflightLimit: Number(env.GENERATION_INFLIGHT_LIMIT),
      },
    );
    return { accepted: true, queued: true, request: status };
  });
  return server;
}

export const MCP_READ_SCOPE = MCP_SCOPES.read;
