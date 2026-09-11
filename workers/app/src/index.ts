import { Hono, type Context, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  UserFlowService,
  MAX_UPLOAD_BYTES,
} from "../../../packages/data/src/user-flows";
import { createAuth, mailAvailable, mcpAvailable, mcpResource } from "./auth";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { buildMcpServer } from "./mcp/tools";
import type { McpTokenInfo } from "./mcp/resource-server";
import {
  MCP_SCOPES,
  mcpToolMeta,
  type McpToolName,
} from "../../../packages/domain/src/mcp";
import { logOps, type OpsReason } from "./observability";
import { GenerationService } from "../../../packages/data/src/generation";
import { generationSchema } from "../../../packages/domain/src/generation";
import { recordAuthorizationIntent } from "./oauth-grants";
import type { AppEnv } from "./env";
import {
  initializeActor,
  type Actor,
} from "../../../packages/data/src/services";
import {
  DomainError,
  profileCreateSchema,
  profilePatchSchema,
  saveCreateSchema,
  savePatchSchema,
  draftPatchSchema,
  approvalSchema,
  jobQuerySchema,
  pageQuerySchema,
  archiveSchema,
  safeUrl,
} from "../../../packages/domain/src/contracts";
import type { z } from "zod";
type Bindings = {
  Bindings: AppEnv;
  // authUserId is the Better Auth subject. OAuth grants are keyed by it, while
  // every business record is keyed by the immutable actor id; both come from the
  // same verified session and neither is ever client supplied.
  Variables: { actor: Actor; data: UserFlowService; authUserId: string };
};
function routeId(c: Context<Bindings>) {
  const id = c.req.param("id");
  if (!id || id.length > 200) throw new DomainError("invalid_id", 400);
  return id;
}
const app = new Hono<Bindings>();
app.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Robots-Tag", "noindex, nofollow");
});
app.use("*", async (c: Context<Bindings, string>, next) => {
  const upload =
    c.req.method === "POST" &&
    /^\/api\/profiles\/[^/]+\/attachments$/.test(c.req.path);
  const limit: MiddlewareHandler<Bindings> = bodyLimit({
    maxSize: upload ? MAX_UPLOAD_BYTES + 64 * 1024 : 256 * 1024,
    onError: (c) => c.json({ error: "body_too_large" }, 413),
  });
  return limit(c, next);
});
app.onError((error, c) =>
  error instanceof DomainError
    ? c.json({ error: error.code }, error.status)
    : c.json({ error: "internal_error" }, 500),
);
// OAuth protocol endpoints that non-browser clients call without an Origin
// header. Every one of them authenticates its caller by something a browser
// cannot replay from another origin: client credentials, a PKCE verifier, or a
// bearer token. None of them accepts a session cookie as authority, so exempting
// them cannot hand a cross-origin page access to a cookie-authenticated API.
//
// Exact paths, never a prefix. /auth/oauth2/authorize, /auth/oauth2/consent and
// /auth/oauth2/continue are deliberately absent: those are cookie-backed browser
// steps and keep the full Origin check below.
const ORIGIN_EXEMPT_PATHS = new Set([
  "/auth/oauth2/token",
  "/auth/oauth2/register",
  "/auth/oauth2/introspect",
  "/auth/oauth2/revoke",
  "/mcp",
]);
// Apply CSRF protection to every mutation, including our business endpoints.
app.use("*", async (c, next) => {
  if (
    !["GET", "HEAD", "OPTIONS"].includes(c.req.method) &&
    !ORIGIN_EXEMPT_PATHS.has(c.req.path)
  ) {
    if (
      c.req.header("Origin") !== c.env.APP_ORIGIN ||
      c.req.header("Sec-Fetch-Site") === "cross-site"
    )
      return c.json({ error: "untrusted_origin" }, 403);
  }
  await next();
});
// Consent management stays reachable even when the MCP release flag is off, so a
// user can always withdraw access they previously granted. Everything else in the
// OAuth surface is gated with the flag.
const CONSENT_MANAGEMENT_PATHS = new Set([
  "/auth/oauth2/get-consents",
  "/auth/oauth2/get-consent",
]);
app.all("/auth/*", async (c) => {
  // Machine-to-machine and platform administration are out of scope for this
  // application. The plugin registers them; we never serve them.
  //
  // /auth/mcp-token-info is this Worker's own resource-server helper. It is
  // blocked at the edge so it is reachable only through the direct server-side
  // auth.api call in the /mcp route, never as a public introspection oracle.
  if (
    c.req.path.startsWith("/auth/admin/") ||
    c.req.path === "/auth/oauth2/delete-consent" ||
    c.req.path === "/auth/oauth2/update-consent" ||
    c.req.path === "/auth/mcp-token-info"
  )
    return c.json({ error: "not_found" }, 404);
  if (
    (c.req.path.startsWith("/auth/oauth2/") ||
      c.req.path.startsWith("/auth/.well-known/")) &&
    !CONSENT_MANAGEMENT_PATHS.has(c.req.path) &&
    !mcpAvailable(c.env)
  )
    return c.json({ error: "mcp_not_ready", enabled: false }, 503);
  const mailPaths = [
    "/auth/sign-up/email",
    "/auth/request-password-reset",
    "/auth/forget-password",
    "/auth/send-verification-email",
  ];
  if (mailPaths.includes(c.req.path) && !mailAvailable(c.env))
    return c.json({ error: "mail_unavailable" }, 503);
  if (!c.env.BETTER_AUTH_SECRET || c.env.BETTER_AUTH_SECRET.length < 32)
    return c.json({ error: "auth_unavailable" }, 503);
  const delivery = { failed: false };
  let response: Response | undefined;
  try {
    const auth = createAuth(c.env, () => {
      delivery.failed = true;
    });
    if (c.req.method === "GET" && c.req.path === "/auth/oauth2/authorize") {
      const session = await auth.api.getSession({ headers: c.req.raw.headers });
      if (session?.user.emailVerified)
        await recordAuthorizationIntent(
          c.env.DB,
          session.user.id,
          session.session.id,
          new URL(c.req.url).searchParams.toString(),
        );
    } else if (
      c.req.method === "POST" &&
      c.req.path === "/auth/oauth2/consent"
    ) {
      const session = await auth.api.getSession({ headers: c.req.raw.headers });
      const body = (await c.req.raw
        .clone()
        .json()
        .catch(() => null)) as Record<string, unknown> | null;
      if (
        session?.user.emailVerified &&
        body?.accept === true &&
        typeof body.oauth_query === "string"
      )
        await recordAuthorizationIntent(
          c.env.DB,
          session.user.id,
          session.session.id,
          body.oauth_query,
        );
    }
    response = await auth.handler(c.req.raw);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("oauth_grant_inactive")
    )
      return c.json({ error: "invalid_grant" }, 400);
    // Resend awaits the callback directly, unlike signup/reset. Normalize only
    // a failure observed by this request's transport callback on a mail route.
    if (!mailPaths.includes(c.req.path) || !delivery.failed) throw error;
  }
  if (mailPaths.includes(c.req.path) && (response?.ok || delivery.failed)) {
    // The public response must be identical when an account is absent: the auth
    // library deliberately skips that account's mail callback. A failure-only 503
    // would otherwise reveal account existence during a provider outage.
    await c.env.DB.prepare(
      "INSERT INTO audit_events(id,actor_user_id,action,entity_type,entity_id,revision,created_at) VALUES(?,NULL,?,?,?,NULL,?)",
    )
      .bind(
        crypto.randomUUID(),
        delivery.failed ? "mail_delivery_failed" : "mail_request_received",
        c.req.path.includes("password")
          ? "auth_reset_mail"
          : "auth_verification_mail",
        crypto.randomUUID(),
        new Date().toISOString(),
      )
      .run();
    return c.json(
      {
        status: true,
        message:
          "Request received. Email delivery is attempted for eligible accounts; delivery is not confirmed.",
      },
      202,
    );
  }
  if (!response) throw new Error("AUTH_RESPONSE_UNAVAILABLE");
  return response;
});
// Authenticate only recognized routes. An unknown API is always JSON 404.
async function authenticated(c: Context<Bindings>, next: () => Promise<void>) {
  if (!c.env.BETTER_AUTH_SECRET || c.env.BETTER_AUTH_SECRET.length < 32)
    return c.json({ error: "auth_unavailable" }, 503);
  const session = await createAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  });
  if (!session?.user.emailVerified)
    return c.json({ error: "unauthenticated" }, 401);
  const actor = await initializeActor(c.env.DB, session.user);
  c.set("actor", actor);
  c.set("authUserId", session.user.id);
  c.set("data", new UserFlowService(c.env.DB, actor));
  await next();
}
async function writable(c: Context<Bindings>, next: () => Promise<void>) {
  if (c.env.WRITES_ENABLED !== "true")
    return c.json({ error: "writes_disabled" }, 503);
  await next();
}
async function parse<T>(
  c: Context<Bindings>,
  schema: z.ZodType<T>,
): Promise<T> {
  if (!c.req.header("Content-Type")?.startsWith("application/json"))
    throw new DomainError("json_required", 400);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new DomainError("invalid_json", 400);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new DomainError("invalid_request", 400);
  return parsed.data;
}
function pageQuery(c: Context<Bindings>) {
  const parsed = pageQuerySchema.safeParse(c.req.query());
  if (!parsed.success) throw new DomainError("invalid_query", 400);
  return parsed.data;
}
// Better Auth stores string[] columns as JSON text; tolerate a plain
// space/comma separated value rather than crashing the account screen.
function parseScopes(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed))
      return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    /* fall through */
  }
  return value.split(/[\s,]+/).filter(Boolean);
}
type ConsentRow = {
  id: string;
  clientId: string;
  scopes: string | null;
  createdAt: number | null;
  clientName: string | null;
  clientUri: string | null;
};
app.get("/api/connected-apps", authenticated, async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT k.id,k.clientId,k.scopes,k.createdAt,l.name AS clientName,l.uri AS clientUri FROM oauthConsent k LEFT JOIN oauthClient l ON l.clientId=k.clientId WHERE k.userId=? ORDER BY k.createdAt DESC,k.id DESC LIMIT 100",
  )
    .bind(c.get("authUserId"))
    .all<ConsentRow>();
  return c.json({
    items: rows.results.map((r) => ({
      id: r.id,
      clientId: r.clientId,
      // Client-supplied registration metadata. It is displayed as plain text and
      // never as a link target, an image or a verified badge.
      clientName: r.clientName?.slice(0, 200) ?? null,
      clientUri: safeUrl(r.clientUri),
      verified: false,
      scopes: parseScopes(r.scopes),
      connectedAt: r.createdAt,
    })),
  });
});
// Withdrawing access stays available even when business writes are switched
// off: a user must always be able to disconnect something.
app.delete("/api/connected-apps/:id", authenticated, async (c) => {
  const id = routeId(c);
  const authUserId = c.get("authUserId");
  const consent = await c.env.DB.prepare(
    "SELECT clientId FROM oauthConsent WHERE id=? AND userId=?",
  )
    .bind(id, authUserId)
    .first<{ clientId: string }>();
  if (!consent) throw new DomainError("not_found", 404);
  // Deleting the consent alone would leave already-issued tokens usable until
  // they expired. Because access tokens are opaque they are real rows, so the
  // grant and everything minted under it are removed together and the next MCP
  // call fails immediately.
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      "DELETE FROM auth_verification WHERE CASE WHEN json_valid(value) THEN json_extract(value,'$.type')='authorization_code' AND json_extract(value,'$.userId')=? AND json_extract(value,'$.query.client_id')=? ELSE 0 END",
    ).bind(authUserId, consent.clientId),
    c.env.DB.prepare(
      "DELETE FROM oauthAccessToken WHERE clientId=? AND userId=?",
    ).bind(consent.clientId, authUserId),
    c.env.DB.prepare(
      "DELETE FROM oauthRefreshToken WHERE clientId=? AND userId=?",
    ).bind(consent.clientId, authUserId),
    c.env.DB.prepare(
      "DELETE FROM oauthConsent WHERE clientId=? AND userId=?",
    ).bind(consent.clientId, authUserId),
    c.env.DB.prepare(
      "INSERT INTO audit_events(id,actor_user_id,action,entity_type,entity_id,revision,created_at) VALUES(?,?,'revoke','connected_app',?,NULL,?)",
    ).bind(
      crypto.randomUUID(),
      c.get("actor").id,
      id,
      new Date().toISOString(),
    ),
  ]);
  logOps("connected_app_revoked", {
    reason: "user_revoked",
    clientId: consent.clientId,
    count: results[1].meta.changes + results[2].meta.changes,
  });
  return c.json({
    revoked: true,
    authorizationCodesRemoved: results[0].meta.changes,
    accessTokensRemoved: results[1].meta.changes,
    refreshTokensRemoved: results[2].meta.changes,
  });
});
app.get("/api/job-options", authenticated, async (c) =>
  c.json(await c.get("data").jobOptions()),
);
app.get("/api/activity", authenticated, async (c) => {
  const q = pageQuery(c);
  return c.json(await c.get("data").activity(q.limit, q.cursor));
});
app.post("/api/profiles/:id/archive", authenticated, writable, async (c) => {
  const input = await parse(c, archiveSchema);
  return c.json(
    await c
      .get("data")
      .archive(routeId(c), input.expectedRevision, input.archived),
  );
});
app.get("/api/profiles/:id/attachments", authenticated, async (c) =>
  c.json(await c.get("data").attachments(routeId(c))),
);
app.post(
  "/api/profiles/:id/attachments",
  authenticated,
  writable,
  async (c) => {
    if (!c.req.header("Content-Type")?.startsWith("multipart/form-data"))
      throw new DomainError("multipart_required", 400);
    let form: FormData;
    try {
      form = await c.req.raw.formData();
    } catch {
      throw new DomainError("invalid_request", 400);
    }
    const keys = [...form.keys()];
    if (
      keys.length !== 2 ||
      !keys.includes("file") ||
      !keys.includes("expectedRevision")
    )
      throw new DomainError("invalid_request", 400);
    const file = form.get("file"),
      revision = Number(form.get("expectedRevision"));
    if (
      !(file instanceof File) ||
      !Number.isSafeInteger(revision) ||
      revision < 1
    )
      throw new DomainError("invalid_request", 400);
    return c.json(
      await c
        .get("data")
        .upload(routeId(c), revision, file, c.env.PRIVATE_FILES),
      201,
    );
  },
);
app.get("/api/saved-jobs/:id/drafts", authenticated, async (c) =>
  c.json(await c.get("data").draftList(routeId(c))),
);
app.get("/api/drafts/:id/history", authenticated, async (c) =>
  c.json(await c.get("data").draftHistory(routeId(c))),
);
app.get("/api/session", authenticated, (c) =>
  c.json({
    user: c.get("actor"),
    flags: {
      generationEnabled:
        c.env.GENERATION_ENABLED === "true" && c.env.WRITES_ENABLED === "true",
      mcpEnabled: mcpAvailable(c.env),
      mcpWritesEnabled: c.env.MCP_WRITES_ENABLED === "true",
      mcpGenerationEnabled: c.env.MCP_GENERATION_ENABLED === "true",
      mcpReviewEnabled: c.env.MCP_REVIEW_ENABLED === "true",
      writesEnabled: c.env.WRITES_ENABLED === "true",
    },
  }),
);
app.get("/api/saved-jobs/:id/generation", authenticated, async (c) => {
  const data = new GenerationService(c.env.DB, c.get("actor"));
  return c.json({
    ...(await data.options(routeId(c))),
    enabled:
      c.env.GENERATION_ENABLED === "true" && c.env.WRITES_ENABLED === "true",
  });
});
app.post("/api/generation-requests", authenticated, writable, async (c) => {
  const input = await parse(c, generationSchema);
  const data = new GenerationService(c.env.DB, c.get("actor"));
  return c.json(
    await data.request(input, {
      enabled: c.env.GENERATION_ENABLED === "true",
      dailyLimit: Number(c.env.GENERATION_DAILY_LIMIT),
      inflightLimit: Number(c.env.GENERATION_INFLIGHT_LIMIT),
    }),
    202,
  );
});
app.get("/api/generation-requests/:id", authenticated, async (c) =>
  c.json(
    await new GenerationService(c.env.DB, c.get("actor")).status(routeId(c)),
  ),
);
app.get("/api/dashboard", authenticated, async (c) =>
  c.json(await c.get("data").dashboard(pageQuery(c))),
);
app.get("/api/jobs", authenticated, async (c) => {
  const parsed = jobQuerySchema.safeParse(c.req.query());
  if (!parsed.success) throw new DomainError("invalid_query", 400);
  return c.json(await c.get("data").jobs(parsed.data));
});
app.get("/api/jobs/:id/save-state", authenticated, async (c) => {
  const job = await c.get("data").job(routeId(c));
  const row = await c.env.DB.prepare(
    "SELECT id FROM saved_jobs WHERE user_id=? AND job_id=?",
  )
    .bind(c.get("actor").id, job.id)
    .first<{ id: string }>();
  return c.json({ savedJobId: row?.id ?? null });
});
app.get("/api/jobs/:id", authenticated, async (c) =>
  c.json(await c.get("data").job(routeId(c))),
);
app.get("/api/profiles", authenticated, async (c) =>
  c.json(await c.get("data").profiles()),
);
app.post("/api/profiles", authenticated, writable, async (c) =>
  c.json(
    await c.get("data").createProfile(await parse(c, profileCreateSchema)),
    201,
  ),
);
app.get("/api/profiles/:id", authenticated, async (c) =>
  c.json(await c.get("data").getProfile(routeId(c))),
);
app.patch("/api/profiles/:id", authenticated, writable, async (c) =>
  c.json(
    await c
      .get("data")
      .editProfile(routeId(c), await parse(c, profilePatchSchema)),
  ),
);
app.post("/api/profiles/:id/activate", authenticated, writable, async (c) => {
  await parse(c, approvalSchema.pick({}).strict());
  return c.json(await c.get("data").activateProfile(routeId(c)));
});
app.get("/api/saved-jobs", authenticated, async (c) =>
  c.json(await c.get("data").saves(pageQuery(c))),
);
app.post("/api/saved-jobs", authenticated, writable, async (c) =>
  c.json(
    await c.get("data").createSave((await parse(c, saveCreateSchema)).jobId),
  ),
);
app.get("/api/saved-jobs/:id", authenticated, async (c) =>
  c.json(await c.get("data").getSave(routeId(c))),
);
app.patch("/api/saved-jobs/:id", authenticated, writable, async (c) =>
  c.json(
    await c.get("data").editSave(routeId(c), await parse(c, savePatchSchema)),
  ),
);
app.get("/api/drafts/:id", authenticated, async (c) =>
  c.json(await c.get("data").getDraft(routeId(c))),
);
app.patch("/api/drafts/:id", authenticated, writable, async (c) =>
  c.json(
    await c.get("data").editDraft(routeId(c), await parse(c, draftPatchSchema)),
  ),
);
app.post("/api/drafts/:id/approve", authenticated, writable, async (c) =>
  c.json(
    await c
      .get("data")
      .editDraft(routeId(c), await parse(c, approvalSchema), true),
  ),
);
app.get("/api/attachments/:id/download", authenticated, async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT object_key,filename,media_type,size_bytes,checksum_sha256,status,scan_status FROM attachments WHERE id=? AND user_id=?",
  )
    .bind(routeId(c), c.get("actor").id)
    .first<{
      object_key: string | null;
      filename: string | null;
      media_type: string | null;
      size_bytes: number | null;
      checksum_sha256: string | null;
      status: string;
      scan_status: string;
    }>();
  if (!row) throw new DomainError("not_found", 404);
  if (
    row.status !== "available" ||
    row.scan_status !== "clean" ||
    !row.object_key
  )
    throw new DomainError("attachment_unavailable", 409);
  const object = await c.env.PRIVATE_FILES.get(row.object_key);
  if (!object) throw new DomainError("attachment_unavailable", 409);
  if (object.size !== row.size_bytes) {
    await object.body.cancel();
    throw new DomainError("attachment_integrity_mismatch", 409);
  }
  const filename = (row.filename ?? "download")
    .toWellFormed()
    .replace(/[\x00-\x1f\x7f"\\/]/g, "_");
  return new Response(object.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
    },
  });
});
app.all("/api/generation/*", authenticated, (c) =>
  c.json({ error: "generation_not_ready", enabled: false }, 503),
);
// RFC 9728 challenge. Never HTML, and it names where the client can discover
// how to authorize, so an MCP client can start the flow from a bare 401.
function mcpChallenge(resource: string, error: string, status: 401 | 403) {
  const metadata = new URL(resource);
  metadata.pathname = `/.well-known/oauth-protected-resource${new URL(resource).pathname}`;
  return new Response(JSON.stringify({ error }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "WWW-Authenticate": `Bearer resource_metadata="${metadata.toString()}", error="${error}"`,
    },
  });
}
app.post("/mcp", async (c) => {
  if (!mcpAvailable(c.env))
    return c.json({ error: "mcp_not_ready", enabled: false }, 503);
  if (!c.env.BETTER_AUTH_SECRET || c.env.BETTER_AUTH_SECRET.length < 32)
    return c.json({ error: "auth_unavailable" }, 503);
  const resource = mcpResource(c.env);
  const auth = createAuth(c.env);
  const started = Date.now();
  const refuse = (
    error: string,
    status: 401 | 403,
    reason: OpsReason,
    clientId?: string,
  ) => {
    logOps("mcp_auth_rejected", { reason, status, clientId });
    return mcpChallenge(resource, error, status);
  };
  // A session cookie is never authority here: only a bearer access token that
  // the authorization server still considers active can reach a tool.
  let info: McpTokenInfo;
  try {
    info = await auth.api.mcpTokenInfo({ headers: c.req.raw.headers });
  } catch {
    return refuse("invalid_token", 401, "missing_or_invalid_token");
  }
  // RFC 8707: a token minted for a different resource must not be accepted here.
  if (!info.subject || !info.audiences.includes(resource))
    return refuse("invalid_token", 401, "wrong_audience", info.clientId);
  const account = await c.env.DB.prepare(
    "SELECT id,email,name FROM auth_user WHERE id=? AND emailVerified=1",
  )
    .bind(info.subject)
    .first<{ id: string; email: string; name: string }>();
  // The account must still exist and still be verified at call time, exactly as
  // the cookie path requires.
  if (!account)
    return refuse("invalid_token", 401, "account_unavailable", info.clientId);
  const scopes = new Set(info.scopes);
  if (!scopes.has(MCP_SCOPES.read))
    return refuse(
      "insufficient_scope",
      403,
      "insufficient_scope",
      info.clientId,
    );
  // The same immutable business actor the browser and HTTP API resolve. The
  // client never supplies or influences it.
  const actor = await initializeActor(c.env.DB, account);
  // Modern clients may send Mcp-Name, while the maintained SDK 1.30 transport
  // identifies tools only in JSON-RPC. Retain only an allowlisted name from a
  // bounded clone; ids, arguments, tokens and malformed bodies are discarded.
  let requestedTool: McpToolName | undefined;
  const headerTool = c.req.header("Mcp-Name");
  if (
    headerTool &&
    Object.prototype.hasOwnProperty.call(mcpToolMeta, headerTool)
  )
    requestedTool = headerTool as McpToolName;
  else if ((Number(c.req.header("Content-Length") ?? "0") || 0) <= 256 * 1024) {
    const envelope = (await c.req.raw
      .clone()
      .json()
      .catch(() => null)) as {
      method?: unknown;
      params?: { name?: unknown };
    } | null;
    const bodyTool = envelope?.params?.name;
    if (
      envelope?.method === "tools/call" &&
      typeof bodyTool === "string" &&
      Object.prototype.hasOwnProperty.call(mcpToolMeta, bodyTool)
    )
      requestedTool = bodyTool as McpToolName;
  }
  let toolRejected = false;
  const handler = createMcpHandler(() =>
    buildMcpServer(
      c.env,
      actor,
      { clientId: info.clientId, scopes },
      (tool, reason) => {
        toolRejected = true;
        logOps("mcp_tool_rejected", {
          clientId: info.clientId,
          tool,
          reason,
        });
      },
    ),
  );
  try {
    const response = await handler.fetch(c.req.raw, {
      authInfo: {
        // The access token itself is deliberately not forwarded into the MCP
        // server: no tool needs it, and not passing it keeps it out of any
        // downstream logging.
        token: "",
        clientId: info.clientId,
        scopes: info.scopes,
        ...(info.expiresAt ? { expiresAt: info.expiresAt } : {}),
        resource: new URL(resource),
      },
    });
    if (requestedTool && !toolRejected) {
      // Registered tool failures are logged by their callback. This covers
      // protocol/schema rejection that occurs before a callback is entered.
      const rejected = await response
        .clone()
        .text()
        .then((body) => /"(?:isError|error)"\s*:\s*(?:true|\{)/.test(body));
      if (rejected)
        logOps("mcp_tool_rejected", {
          clientId: info.clientId,
          tool: requestedTool,
          reason: "invalid_request",
          status: response.status,
        });
    }
    logOps("mcp_call_completed", {
      clientId: info.clientId,
      status: response.status,
      durationMs: Date.now() - started,
    });
    return response;
  } finally {
    await handler.close();
  }
});
app.all("/mcp", (c) => c.json({ error: "method_not_allowed" }, 405));
app.all("/mcp/*", (c) => c.json({ error: "not_found" }, 404));
// RFC 8414 and RFC 9728 documents must answer at the well-known root, while the
// plugin registers them under Better Auth's base path. Only these exact paths
// are served; every other /.well-known/* stays a JSON 404.
const DISCOVERY_PATHS = new Set([
  "/.well-known/oauth-authorization-server",
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/mcp",
]);
app.get("/.well-known/*", async (c) => {
  if (!DISCOVERY_PATHS.has(c.req.path))
    return c.json({ error: "not_found" }, 404);
  if (!mcpAvailable(c.env))
    return c.json({ error: "mcp_not_ready", enabled: false }, 503);
  if (!c.env.BETTER_AUTH_SECRET || c.env.BETTER_AUTH_SECRET.length < 32)
    return c.json({ error: "auth_unavailable" }, 503);
  const auth = createAuth(c.env);
  // The protected-resource document is served from the raw path by the plugin's
  // request hook; the authorization-server document is a base-path endpoint.
  const direct = await auth.handler(new Request(c.req.url, c.req.raw));
  if (direct.status !== 404) return direct;
  const url = new URL(c.req.url);
  url.pathname = `/auth${c.req.path}`;
  return auth.handler(new Request(url, c.req.raw));
});
app.all("/.well-known/*", (c) => c.json({ error: "not_found" }, 404));
app.notFound(async (c) => {
  if (/^\/(api|auth|mcp|\.well-known)(\/|$)/.test(c.req.path))
    return c.json({ error: "not_found" }, 404);
  if (!["GET", "HEAD"].includes(c.req.method))
    return c.json({ error: "not_found" }, 404);
  // Vite emits public executable assets only under this exact prefix. Never return HTML here.
  if (/^\/assets\/[^/]+\.(js|css|woff2?)$/.test(c.req.path))
    return c.env.ASSETS.fetch(c.req.raw);
  const publicPages = [
    "/login",
    "/sign-up",
    "/forgot-password",
    "/reset-password",
    "/link-expired",
  ];
  const privatePages = [
    "/",
    "/jobs",
    "/profile",
    "/onboarding",
    "/account",
    "/consent",
    "/job-details",
    "/saved-job-details",
  ];
  const detail = /^\/(jobs|saved-jobs)\/([^/]+)$/.exec(c.req.path);
  if (
    !publicPages.includes(c.req.path) &&
    !privatePages.includes(c.req.path) &&
    !detail
  )
    return c.text("Page not found", 404);
  if (!publicPages.includes(c.req.path)) {
    const session = c.env.BETTER_AUTH_SECRET
      ? await createAuth(c.env).api.getSession({ headers: c.req.raw.headers })
      : null;
    if (!session?.user.emailVerified)
      return c.redirect(
        "/login?next-page=" +
          encodeURIComponent(c.req.path + new URL(c.req.url).search),
        302,
      );
    const actor = await initializeActor(c.env.DB, session.user),
      data = new UserFlowService(c.env.DB, actor);
    if (c.req.path === "/job-details" || detail?.[1] === "jobs") {
      const id = detail?.[2] ?? c.req.query("recordId");
      if (!id) return c.text("Job not found", 404);
      try {
        await data.job(decodeURIComponent(id));
      } catch (error) {
        if (error instanceof DomainError && error.status === 404)
          return c.text("Job not found", 404);
        throw error;
      }
    }
    if (c.req.path === "/saved-job-details" || detail?.[1] === "saved-jobs") {
      const id = detail?.[2] ?? c.req.query("recordId");
      if (!id) return c.text("Saved job not found", 404);
      try {
        await data.save(decodeURIComponent(id));
      } catch (error) {
        if (error instanceof DomainError && error.status === 404)
          return c.text("Saved job not found", 404);
        throw error;
      }
    }
    if (c.req.path === "/") {
      const profiles = await data.profiles();
      if (!profiles.items.some((p) => !p.archived))
        return c.redirect("/onboarding", 302);
    }
  }
  c.header("X-Robots-Tag", "noindex, nofollow");
  c.header(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  );
  return c.env.ASSETS.fetch(new Request(new URL("/index.html", c.req.url)));
});
export default app;
