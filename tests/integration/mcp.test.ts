import { beforeEach, expect, test } from "vitest";
import { env, SELF, account, setup, seedJob, request } from "./helpers";
import type { AppEnv } from "../../workers/app/src/env";

beforeEach(setup);

const RESOURCE = "https://app.test/mcp";
const REDIRECT = "https://client.test/callback";
const ALL_SCOPES =
  "offline_access app:read app:write drafts:generate drafts:review";

async function pkce() {
  const verifier = `verifier-${crypto.randomUUID()}${crypto.randomUUID()}`;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return { verifier, challenge };
}

async function registerClient(name = "Probe MCP Client") {
  const response = await SELF.fetch("https://app.test/auth/oauth2/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: name,
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: ALL_SCOPES,
    }),
  });
  const body = (await response.json()) as Record<string, unknown>;
  if (response.status >= 400)
    throw new Error(`register ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

/** Runs the authorization-code + PKCE flow exactly as an MCP client does. */
async function authorize(
  cookie: string,
  clientId: string,
  scope: string,
  overrides: Record<string, string> = {},
) {
  const { verifier, challenge } = await pkce();
  const url = new URL("https://app.test/auth/oauth2/authorize");
  const params: Record<string, string> = {
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    scope,
    state: "state-123",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: RESOURCE,
    ...overrides,
  };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const response = await SELF.fetch(url, {
    headers: { Cookie: cookie },
    redirect: "manual",
  });
  return { response, verifier };
}

async function consent(cookie: string, location: string, accept = true) {
  const oauthQuery = location.slice(location.indexOf("?") + 1);
  const response = await SELF.fetch("https://app.test/auth/oauth2/consent", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      Origin: "https://app.test",
    },
    body: JSON.stringify({ accept, oauth_query: oauthQuery }),
  });
  const body = (await response.json()) as { url?: string };
  return { status: response.status, url: body.url ?? "" };
}

async function exchange(
  clientId: string,
  code: string,
  verifier: string,
  extra: Record<string, string> = {},
) {
  const response = await SELF.fetch("https://app.test/auth/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT,
      resource: RESOURCE,
      ...extra,
    }),
  });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, string>,
  };
}

/** Full connect: register (optional), authorize, consent, exchange. */
async function connect(cookie: string, scope = "app:read offline_access") {
  const clientId = String((await registerClient()).client_id);
  const { response, verifier } = await authorize(cookie, clientId, scope);
  expect(response.status).toBe(302);
  const accepted = await consent(
    cookie,
    response.headers.get("location") ?? "",
  );
  const code = new URL(accepted.url).searchParams.get("code") ?? "";
  const token = await exchange(clientId, code, verifier);
  expect(token.status).toBe(200);
  return { clientId, verifier, code, tokens: token.body };
}

const MCP_REVISION = "2026-07-28";
const envelope = {
  "io.modelcontextprotocol/protocolVersion": MCP_REVISION,
  "io.modelcontextprotocol/clientInfo": { name: "test-client", version: "1.0" },
  "io.modelcontextprotocol/clientCapabilities": {},
};
async function rpc(
  accessToken: string,
  method: string,
  params: Record<string, unknown> = {},
  runtimeEnv?: AppEnv,
) {
  const request = new Request("https://app.test/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${accessToken}`,
      "MCP-Protocol-Version": MCP_REVISION,
      "Mcp-Method": method,
      // 2026-07-28 requires the headers and body to agree on what is being
      // invoked, so the target name is routed in the header too.
      ...(typeof params.name === "string" ? { "Mcp-Name": params.name } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params: { ...params, _meta: envelope },
    }),
  });
  const response = runtimeEnv
    ? await (
        await import("../../workers/app/src/index")
      ).default.fetch(request, runtimeEnv)
    : await SELF.fetch(request);
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    const last = text
      .trim()
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .at(-1);
    if (last)
      body = JSON.parse(last.slice(5).trim()) as Record<string, unknown>;
  }
  return { status: response.status, text, body };
}

async function namesWithEnv(accessToken: string, runtimeEnv: AppEnv) {
  const out = await rpc(accessToken, "tools/list", {}, runtimeEnv);
  const result = out.body.result as { tools?: { name: string }[] } | undefined;
  return (result?.tools ?? []).map((tool) => tool.name);
}

async function call(
  accessToken: string,
  name: string,
  args: unknown = {},
  runtimeEnv?: AppEnv,
) {
  const out = await rpc(
    accessToken,
    "tools/call",
    {
      name,
      arguments: args,
    },
    runtimeEnv,
  );
  const result = (out.body.result ?? {}) as {
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
  };
  return {
    status: out.status,
    jsonrpcError: out.body.error as
      { code: number; message: string } | undefined,
    isError: result.isError === true,
    data: result.structuredContent ?? {},
  };
}

async function toolNames(accessToken: string) {
  const out = await rpc(accessToken, "tools/list");
  const result = out.body.result as { tools?: { name: string }[] } | undefined;
  return (result?.tools ?? []).map((t) => t.name).sort();
}

// ---------------------------------------------------------------- discovery

test("discovery documents describe this resource and its authorization server", async () => {
  const meta = await SELF.fetch(
    "https://app.test/.well-known/oauth-authorization-server",
  );
  expect(meta.status).toBe(200);
  const server = (await meta.json()) as Record<string, unknown>;
  expect(server.issuer).toBe("https://app.test/auth");
  expect(server.token_endpoint).toBe("https://app.test/auth/oauth2/token");
  expect(server.scopes_supported).toContain("app:read");

  const prm = await SELF.fetch(
    "https://app.test/.well-known/oauth-protected-resource/mcp",
  );
  expect(prm.status).toBe(200);
  const resource = (await prm.json()) as Record<string, unknown>;
  expect(resource.resource).toBe(RESOURCE);
  expect(resource.authorization_servers).toEqual(["https://app.test/auth"]);
});

test("unknown well-known and MCP subpaths stay JSON errors, never HTML", async () => {
  for (const path of [
    "/.well-known/unknown",
    "/.well-known/oauth-protected-resource/other",
    "/mcp/unknown",
  ]) {
    const response = await SELF.fetch(`https://app.test${path}`);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.headers.get("content-type") ?? "").toContain(
      "application/json",
    );
  }
});

test("the MCP release flag gates the protocol surface", async () => {
  const { default: app } = await import("../../workers/app/src/index");
  const cases: [string, string][] = [
    ["/mcp", "POST"],
    ["/auth/oauth2/register", "POST"],
    ["/.well-known/oauth-authorization-server", "GET"],
  ];
  for (const [path, method] of cases) {
    const response = await app.fetch(
      new Request(`https://app.test${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "GET" ? undefined : "{}",
      }),
      { ...env, MCP_ENABLED: "false" },
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ enabled: false });
  }
});

// ----------------------------------------------------------- authentication

test("unauthenticated MCP answers an RFC 9728 bearer challenge", async () => {
  const response = await SELF.fetch("https://app.test/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  expect(response.status).toBe(401);
  expect(response.headers.get("content-type") ?? "").not.toContain("text/html");
  expect(response.headers.get("www-authenticate") ?? "").toContain(
    `resource_metadata="https://app.test/.well-known/oauth-protected-resource/mcp"`,
  );
});

test("a session cookie alone is never MCP authority", async () => {
  const a = await account("alice");
  const response = await SELF.fetch("https://app.test/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: a.cookie },
    body: "{}",
  });
  expect(response.status).toBe(401);
});

test("a fabricated or unknown bearer token is rejected", async () => {
  for (const token of ["not-a-token", "", "a".repeat(64)]) {
    const out = await rpc(token, "tools/list");
    expect(out.status).toBe(401);
  }
});

test("the internal token-info helper and admin endpoints are not reachable over HTTP", async () => {
  const a = await account("alice");
  for (const path of [
    "/auth/mcp-token-info",
    "/auth/admin/oauth2/create-client",
  ]) {
    const response = await SELF.fetch(`https://app.test${path}`, {
      headers: { Cookie: a.cookie },
    });
    expect(response.status).toBe(404);
  }
});

test("a token minted for another resource cannot call this MCP server", async () => {
  const a = await account("alice");
  const { tokens } = await connect(a.cookie);
  // Re-point the stored grant at a different protected resource. The token is
  // still active; only its audience changed.
  await env.DB.prepare("UPDATE oauthAccessToken SET resources=?")
    .bind(JSON.stringify(["https://elsewhere.test/mcp"]))
    .run();
  const out = await rpc(String(tokens.access_token), "tools/list");
  expect(out.status).toBe(401);
});

// ------------------------------------------------------------------- scopes

test("a read-only grant never sees or reaches a mutating tool", async () => {
  const a = await account("alice");
  await seedJob();
  const { tokens } = await connect(a.cookie, "app:read");
  const names = await toolNames(String(tokens.access_token));
  expect(names).toContain("list_jobs");
  expect(names).toContain("get_draft");
  expect(names).not.toContain("save_job");
  expect(names).not.toContain("update_profile");
  expect(names).not.toContain("approve_draft");
  expect(names).not.toContain("request_draft_generation");

  const blocked = await call(String(tokens.access_token), "save_job", {
    jobId: "job-1",
  });
  // An unregistered tool is refused by the protocol itself, not silently run.
  expect(blocked.jsonrpcError ?? blocked.isError).toBeTruthy();
  expect(
    await env.DB.prepare("SELECT count(*) AS c FROM saved_jobs").first<{
      c: number;
    }>(),
  ).toMatchObject({ c: 0 });
});

test("editing and approving are separate capabilities", async () => {
  const a = await account("alice");
  await seedJob();
  const write = await connect(a.cookie, "app:read app:write");
  const writeNames = await toolNames(String(write.tokens.access_token));
  expect(writeNames).toContain("update_draft");
  expect(writeNames).not.toContain("approve_draft");

  const review = await connect(a.cookie, "app:read drafts:review");
  const reviewNames = await toolNames(String(review.tokens.access_token));
  expect(reviewNames).toContain("approve_draft");
  expect(reviewNames).not.toContain("update_draft");
});

test("a grant without the read capability cannot open a session at all", async () => {
  const a = await account("alice");
  const { tokens } = await connect(a.cookie, "offline_access");
  const out = await rpc(String(tokens.access_token), "tools/list");
  expect(out.status).toBe(403);
});

// -------------------------------------------------------------- revocation

test("revoking the token stops the very next MCP call", async () => {
  const a = await account("alice");
  await seedJob();
  const { clientId, tokens } = await connect(a.cookie, "app:read");
  expect((await toolNames(String(tokens.access_token))).length).toBeGreaterThan(
    0,
  );

  const revoked = await SELF.fetch("https://app.test/auth/oauth2/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      token: String(tokens.access_token),
      token_type_hint: "access_token",
    }),
  });
  expect(revoked.status).toBeLessThan(400);

  const after = await rpc(String(tokens.access_token), "tools/list");
  expect(after.status).toBe(401);
});

test("disconnecting the app from the account screen kills its live tokens", async () => {
  const a = await account("alice");
  await seedJob();
  const { tokens } = await connect(a.cookie, "app:read");
  expect((await toolNames(String(tokens.access_token))).length).toBeGreaterThan(
    0,
  );

  const consents = await request("/api/connected-apps", a.cookie);
  expect(consents.status).toBe(200);
  const list = (await consents.json()) as {
    items: { id: string; clientId: string }[];
  };
  expect(list.items.length).toBe(1);

  const removed = await request(
    `/api/connected-apps/${list.items[0].id}`,
    a.cookie,
    "DELETE",
  );
  expect(removed.status).toBe(200);

  const after = await rpc(String(tokens.access_token), "tools/list");
  expect(after.status).toBe(401);
});

test("a pending plain-value password reset cannot block disconnect", async () => {
  const a = await account("alice");
  const { tokens } = await connect(a.cookie, "app:read offline_access");
  await env.DB.prepare(
    "INSERT INTO auth_verification(identifier,value,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?)",
  )
    .bind(
      `reset-password:${crypto.randomUUID()}`,
      a.user.id,
      Date.now() + 60_000,
      Date.now(),
      Date.now(),
    )
    .run();
  const list = (await (
    await request("/api/connected-apps", a.cookie)
  ).json()) as { items: { id: string }[] };
  const removed = await request(
    `/api/connected-apps/${list.items[0].id}`,
    a.cookie,
    "DELETE",
  );
  expect(removed.status).toBe(200);
  expect((await rpc(String(tokens.access_token), "tools/list")).status).toBe(
    401,
  );
  expect(
    await env.DB.prepare("SELECT value FROM auth_verification WHERE value=?")
      .bind(a.user.id)
      .first(),
  ).toBeTruthy();
});

test("disconnect rejects a pending authorization code and later consent cannot revive it", async () => {
  const a = await account("alice");
  await seedJob();
  const clientId = String((await registerClient()).client_id);
  const pending = await authorize(
    a.cookie,
    clientId,
    "app:read offline_access",
  );
  const accepted = await consent(
    a.cookie,
    pending.response.headers.get("location") ?? "",
  );
  const oldCode = new URL(accepted.url).searchParams.get("code") ?? "";

  const list = (await (
    await request("/api/connected-apps", a.cookie)
  ).json()) as { items: { id: string }[] };
  expect(list.items).toHaveLength(1);
  expect(
    (
      await request(
        `/api/connected-apps/${list.items[0].id}`,
        a.cookie,
        "DELETE",
      )
    ).status,
  ).toBe(200);
  expect((await exchange(clientId, oldCode, pending.verifier)).status).toBe(
    400,
  );

  const fresh = await authorize(a.cookie, clientId, "app:read offline_access");
  const reaccepted = await consent(
    a.cookie,
    fresh.response.headers.get("location") ?? "",
  );
  const newCode = new URL(reaccepted.url).searchParams.get("code") ?? "";
  const newTokens = await exchange(clientId, newCode, fresh.verifier);
  expect(newTokens.status).toBe(200);
  expect(
    (await rpc(String(newTokens.body.access_token), "tools/list")).status,
  ).toBe(200);
  expect((await exchange(clientId, oldCode, pending.verifier)).status).toBe(
    400,
  );
});

test("grant epoch serializes both provider issuance gaps and survives re-consent", async () => {
  const a = await account("alice");
  const clientId = String((await registerClient()).client_id);
  const pending = await authorize(
    a.cookie,
    clientId,
    "app:read offline_access",
  );
  const accepted = await consent(
    a.cookie,
    pending.response.headers.get("location") ?? "",
  );
  const code = new URL(accepted.url).searchParams.get("code") ?? "";
  const stored = await env.DB.prepare(
    "SELECT v.identifier,v.value,g.epoch FROM auth_verification v JOIN oauthAuthorizationCodeGrant g ON g.authorizationCodeId=v.identifier WHERE g.userId=? AND g.clientId=?",
  )
    .bind(a.user.id, clientId)
    .first<{ identifier: string; value: string; epoch: number }>();
  expect(stored).toBeTruthy();

  // Provider ordering gap (a): consumeVerificationValue has removed the code,
  // but createUserTokens has not persisted its access/refresh rows yet.
  await env.DB.prepare("DELETE FROM auth_verification WHERE identifier=?")
    .bind(stored!.identifier)
    .run();

  // Model an authorize request that captured the same active epoch and is
  // paused after the consent read but before authorization-code persistence.
  const value = JSON.parse(stored!.value) as {
    query: Record<string, string>;
    sessionId: string;
  };
  await env.DB.prepare(
    "INSERT INTO oauthAuthorizationIntent(userId,clientId,sessionId,codeChallenge,redirectUri,resource,scope,state,expectedEpoch,expiresAt) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(userId,clientId,sessionId,codeChallenge) DO UPDATE SET expectedEpoch=excluded.expectedEpoch,expiresAt=excluded.expiresAt",
  )
    .bind(
      a.user.id,
      clientId,
      value.sessionId,
      value.query.code_challenge,
      value.query.redirect_uri,
      value.query.resource,
      value.query.scope,
      value.query.state,
      stored!.epoch,
      Date.now() + 60_000,
    )
    .run();

  const list = (await (
    await request("/api/connected-apps", a.cookie)
  ).json()) as { items: { id: string }[] };
  expect(
    (
      await request(
        `/api/connected-apps/${list.items[0].id}`,
        a.cookie,
        "DELETE",
      )
    ).status,
  ).toBe(200);

  const insertOldAccess = () =>
    env.DB.prepare(
      "INSERT INTO oauthAccessToken(id,token,clientId,sessionId,userId,authorizationCodeId,resources,expiresAt,createdAt,revoked,scopes) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    )
      .bind(
        crypto.randomUUID(),
        crypto.randomUUID(),
        clientId,
        value.sessionId,
        a.user.id,
        stored!.identifier,
        JSON.stringify([RESOURCE]),
        Date.now() + 60_000,
        Date.now(),
        null,
        JSON.stringify(["app:read"]),
      )
      .run();
  await expect(insertOldAccess()).rejects.toThrow(/oauth_grant_inactive/);

  // Provider ordering gap (b): the old authorize execution attempts to create
  // its code after disconnect. Its captured epoch is no longer active.
  await expect(
    env.DB.prepare(
      "INSERT INTO auth_verification(identifier,value,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?)",
    )
      .bind(
        "stale-code-before-reconsent",
        stored!.value,
        Date.now() + 60_000,
        Date.now(),
        Date.now(),
      )
      .run(),
  ).rejects.toThrow(/oauth_grant_inactive/);

  const fresh = await authorize(a.cookie, clientId, "app:read offline_access");
  const reaccepted = await consent(
    a.cookie,
    fresh.response.headers.get("location") ?? "",
  );
  expect(new URL(reaccepted.url).searchParams.get("code")).toBeTruthy();

  // A new explicit consent advances the epoch; neither the consumed old code
  // nor an old paused authorize intent may inherit that new authority.
  await expect(insertOldAccess()).rejects.toThrow(/oauth_grant_inactive/);
  await expect(
    env.DB.prepare(
      "INSERT INTO auth_verification(identifier,value,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?)",
    )
      .bind(
        "stale-code-after-reconsent",
        stored!.value,
        Date.now() + 60_000,
        Date.now(),
        Date.now(),
      )
      .run(),
  ).rejects.toThrow(/oauth_grant_inactive/);

  // The original client-visible code was consumed in the modeled gap and can
  // never be used again.
  expect((await exchange(clientId, code, pending.verifier)).status).toBe(400);
});

test("provider consent mutation routes cannot bypass complete disconnect", async () => {
  const a = await account("alice");
  await seedJob();
  const { tokens } = await connect(a.cookie, "app:read");
  const list = (await (
    await request("/api/connected-apps", a.cookie)
  ).json()) as { items: { id: string }[] };
  expect(list.items).toHaveLength(1);

  for (const path of [
    "/auth/oauth2/delete-consent",
    "/auth/oauth2/update-consent",
  ]) {
    const response = await request(path, a.cookie, "POST", {
      id: list.items[0].id,
      update: { scopes: ["app:read"] },
    });
    expect(response.status).toBe(404);
  }

  expect((await rpc(String(tokens.access_token), "tools/list")).status).toBe(
    200,
  );
  const after = (await (
    await request("/api/connected-apps", a.cookie)
  ).json()) as { items: { id: string }[] };
  expect(after.items).toHaveLength(1);
});

test("granting access again does not resurrect the revoked token", async () => {
  const a = await account("alice");
  await seedJob();
  const first = await connect(a.cookie, "app:read");
  const list = (await (
    await request("/api/connected-apps", a.cookie)
  ).json()) as { items: { id: string }[] };
  await request(`/api/connected-apps/${list.items[0].id}`, a.cookie, "DELETE");
  expect(
    (await rpc(String(first.tokens.access_token), "tools/list")).status,
  ).toBe(401);

  // The user connects the same client again and gets a fresh token. The old
  // token must stay dead.
  const second = await connect(a.cookie, "app:read");
  expect(second.tokens.access_token).not.toBe(first.tokens.access_token);
  expect(
    (await toolNames(String(second.tokens.access_token))).length,
  ).toBeGreaterThan(0);
  expect(
    (await rpc(String(first.tokens.access_token), "tools/list")).status,
  ).toBe(401);
});

test("connected apps are owner scoped", async () => {
  const a = await account("alice");
  const b = await account("bob");
  await connect(a.cookie, "app:read");
  const bobList = (await (
    await request("/api/connected-apps", b.cookie)
  ).json()) as { items: { id: string }[] };
  expect(bobList.items).toEqual([]);

  const aliceList = (await (
    await request("/api/connected-apps", a.cookie)
  ).json()) as { items: { id: string }[] };
  const stolen = await request(
    `/api/connected-apps/${aliceList.items[0].id}`,
    b.cookie,
    "DELETE",
  );
  expect(stolen.status).toBe(404);
});

// ------------------------------------------------------- flow abuse cases

test("an authorization code cannot be replayed", async () => {
  const a = await account("alice");
  const clientId = String((await registerClient()).client_id);
  const { response, verifier } = await authorize(
    a.cookie,
    clientId,
    "app:read",
  );
  const accepted = await consent(
    a.cookie,
    response.headers.get("location") ?? "",
  );
  const code = new URL(accepted.url).searchParams.get("code") ?? "";
  expect((await exchange(clientId, code, verifier)).status).toBe(200);
  expect(
    (await exchange(clientId, code, verifier)).status,
  ).toBeGreaterThanOrEqual(400);
});

test("a wrong PKCE verifier cannot redeem the code", async () => {
  const a = await account("alice");
  const clientId = String((await registerClient()).client_id);
  const { response } = await authorize(a.cookie, clientId, "app:read");
  const accepted = await consent(
    a.cookie,
    response.headers.get("location") ?? "",
  );
  const code = new URL(accepted.url).searchParams.get("code") ?? "";
  const wrong = await exchange(
    clientId,
    code,
    `verifier-${crypto.randomUUID()}`,
  );
  expect(wrong.status).toBeGreaterThanOrEqual(400);
});

test("an unregistered redirect_uri is refused before the user sees consent", async () => {
  const a = await account("alice");
  const clientId = String((await registerClient()).client_id);
  const { response } = await authorize(a.cookie, clientId, "app:read", {
    redirect_uri: "https://attacker.test/steal",
  });
  const location = response.headers.get("location") ?? "";
  expect(location).not.toContain("attacker.test");
  if (response.status === 302)
    expect(location.startsWith("/consent")).toBe(false);
});

test("refreshing rotates the refresh token and the old one stops working", async () => {
  const a = await account("alice");
  await seedJob();
  const { clientId, tokens } = await connect(
    a.cookie,
    "app:read offline_access",
  );
  const refresh = async (value: string) =>
    SELF.fetch("https://app.test/auth/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: value,
        resource: RESOURCE,
      }),
    });
  const rotated = await refresh(String(tokens.refresh_token));
  expect(rotated.status).toBe(200);
  const next = (await rotated.json()) as Record<string, string>;
  expect(next.access_token).not.toBe(tokens.access_token);
  expect(next.refresh_token).not.toBe(tokens.refresh_token);
  expect((await toolNames(String(next.access_token))).length).toBeGreaterThan(
    0,
  );
  // The configured policy is strict: there is no 30-second MCP retry grace.
  expect((await refresh(String(tokens.refresh_token))).status).toBe(400);
  // Reuse invalidates the rotation family, including the child returned above.
  expect((await refresh(String(next.refresh_token))).status).toBe(400);
});

test("real code, access and refresh expirations are enforced", async () => {
  const a = await account("alice");
  const clientId = String((await registerClient()).client_id);
  const pending = await authorize(
    a.cookie,
    clientId,
    "app:read offline_access",
  );
  const accepted = await consent(
    a.cookie,
    pending.response.headers.get("location") ?? "",
  );
  const code = new URL(accepted.url).searchParams.get("code") ?? "";
  await env.DB.prepare(
    "UPDATE auth_verification SET expiresAt=? WHERE json_extract(value,'$.type')='authorization_code'",
  )
    .bind(Date.now() - 1)
    .run();
  expect((await exchange(clientId, code, pending.verifier)).status).toBe(400);

  const live = await connect(a.cookie, "app:read offline_access");
  await env.DB.prepare("UPDATE oauthAccessToken SET expiresAt=?")
    .bind(Date.now() - 1)
    .run();
  expect(
    (await rpc(String(live.tokens.access_token), "tools/list")).status,
  ).toBe(401);
  await env.DB.prepare("UPDATE oauthRefreshToken SET expiresAt=?")
    .bind(Date.now() - 1)
    .run();
  const expiredRefresh = await SELF.fetch(
    "https://app.test/auth/oauth2/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: live.clientId,
        refresh_token: String(live.tokens.refresh_token),
        resource: RESOURCE,
      }),
    },
  );
  expect(expiredRefresh.status).toBe(400);
});

test("authorization codes and refresh tokens cannot cross clients", async () => {
  const a = await account("alice");
  const clientA = String((await registerClient("Client A")).client_id);
  const clientB = String((await registerClient("Client B")).client_id);
  const pending = await authorize(a.cookie, clientA, "app:read offline_access");
  const accepted = await consent(
    a.cookie,
    pending.response.headers.get("location") ?? "",
  );
  const code = new URL(accepted.url).searchParams.get("code") ?? "";
  expect((await exchange(clientB, code, pending.verifier)).status).toBe(400);

  const live = await connect(a.cookie, "app:read offline_access");
  const wrongClientRefresh = await SELF.fetch(
    "https://app.test/auth/oauth2/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientB,
        refresh_token: String(live.tokens.refresh_token),
        resource: RESOURCE,
      }),
    },
  );
  expect(wrongClientRefresh.status).toBe(400);
});

test("session removal and user verification removal invalidate real access", async () => {
  const a = await account("alice");
  const first = await connect(a.cookie, "app:read");
  await env.DB.prepare("DELETE FROM auth_session WHERE userId=?")
    .bind(a.user.id)
    .run();
  expect(
    (await rpc(String(first.tokens.access_token), "tools/list")).status,
  ).toBe(401);

  const b = await account("bob");
  const second = await connect(b.cookie, "app:read");
  await env.DB.prepare("UPDATE auth_user SET emailVerified=0 WHERE id=?")
    .bind(b.user.id)
    .run();
  expect(
    (await rpc(String(second.tokens.access_token), "tools/list")).status,
  ).toBe(401);
});

test("tampering with the signed consent continuation is rejected", async () => {
  const a = await account("alice");
  const clientId = String((await registerClient()).client_id);
  const pending = await authorize(a.cookie, clientId, "app:read");
  const location = pending.response.headers.get("location") ?? "";
  const query = new URLSearchParams(location.slice(location.indexOf("?") + 1));
  query.set("scope", "app:read app:write");
  const rejected = await consent(a.cookie, `?${query.toString()}`);
  expect(rejected.status).toBe(400);
  expect(
    await env.DB.prepare("SELECT COUNT(*) AS count FROM oauthConsent").first(),
  ).toMatchObject({ count: 0 });
});

test("fresh verified signup preserves the maintained OAuth continuation", async () => {
  const { default: app } = await import("../../workers/app/src/index");
  const clientId = String((await registerClient()).client_id);
  const pending = await authorize("", clientId, "app:read offline_access");
  expect(pending.response.status).toBe(302);
  const loginLocation = pending.response.headers.get("location") ?? "";
  expect(loginLocation).toContain("/login?");
  const oauthQuery = loginLocation.slice(loginLocation.indexOf("?") + 1);
  expect(new URLSearchParams(oauthQuery).get("sig")).toBeTruthy();

  let verificationUrl = "";
  const runtime = {
    ...env,
    MAIL_MODE: "cloudflare",
    MAIL_FROM: "noreply@example.test",
    EMAIL: {
      send: async (message: { text: string }) => {
        verificationUrl = message.text.match(/https?:\/\/\S+/)?.[0] ?? "";
        return { messageId: "synthetic-verification" };
      },
    } as unknown as SendEmail,
  } as AppEnv;
  const email = `fresh-${crypto.randomUUID()}@example.test`;
  const password = "Synthetic-password-123!";
  const signup = await app.fetch(
    new Request("https://app.test/auth/sign-up/email", {
      method: "POST",
      headers: {
        Origin: "https://app.test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Fresh user",
        email,
        password,
        oauth_query: oauthQuery,
        callbackURL: `https://app.test/login?${oauthQuery}`,
      }),
    }),
    runtime,
  );
  expect(signup.status).toBe(202);
  expect(verificationUrl).toBeTruthy();

  const verified = await app.fetch(
    new Request(verificationUrl, { redirect: "manual" }),
    runtime,
  );
  expect(verified.status).toBe(302);
  expect(verified.headers.get("location")).toBe(
    `https://app.test/login?${oauthQuery}`,
  );

  const signedIn = await app.fetch(
    new Request("https://app.test/auth/sign-in/email", {
      method: "POST",
      headers: {
        Origin: "https://app.test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password, oauth_query: oauthQuery }),
    }),
    runtime,
  );
  expect(signedIn.status).toBe(200);
  const next = (await signedIn.json()) as { redirect?: boolean; url?: string };
  expect(next.redirect).toBe(true);
  expect(next.url).toContain("/consent?");
  expect(
    new URL(next.url!, "https://app.test").searchParams.get("sig"),
  ).toBeTruthy();
});

// ------------------------------------------------------------ tool behaviour

test("tools read and write only the caller's own records", async () => {
  const a = await account("alice");
  const b = await account("bob");
  await seedJob();
  const alice = await connect(a.cookie, "app:read app:write");
  const bob = await connect(b.cookie, "app:read app:write");

  const saved = await call(String(alice.tokens.access_token), "save_job", {
    jobId: "job-1",
  });
  expect(saved.isError).toBe(false);
  const savedId = String(saved.data.id);

  const bobSees = await call(
    String(bob.tokens.access_token),
    "list_saved_jobs",
    {},
  );
  expect((bobSees.data.items as unknown[]).length).toBe(0);

  const stolen = await call(String(bob.tokens.access_token), "get_saved_job", {
    savedJobId: savedId,
  });
  expect(stolen.isError).toBe(true);
  expect(stolen.data).toMatchObject({ error: "not_found" });
});

test("unknown keys are rejected rather than ignored", async () => {
  const a = await account("alice");
  await seedJob();
  const { tokens } = await connect(a.cookie, "app:read app:write");
  const lines: string[] = [];
  const original = console.log;
  console.log = (line: string) => lines.push(String(line));
  let forged: Awaited<ReturnType<typeof call>>;
  try {
    forged = await call(String(tokens.access_token), "save_job", {
      jobId: "job-1",
      userId: "victim",
    });
  } finally {
    console.log = original;
  }
  expect(forged.isError || forged.jsonrpcError).toBeTruthy();
  expect(
    await env.DB.prepare("SELECT count(*) AS c FROM saved_jobs").first<{
      c: number;
    }>(),
  ).toMatchObject({ c: 0 });
  expect(
    lines
      .map((line) => JSON.parse(line))
      .filter((entry) => entry.event === "mcp_tool_rejected"),
  ).toContainEqual(
    expect.objectContaining({
      event: "mcp_tool_rejected",
      reason: "invalid_request",
      tool: "save_job",
    }),
  );
  expect(lines.join("\n")).not.toContain("victim");
});

test("a repeated create reuses the idempotency key instead of duplicating", async () => {
  const a = await account("alice");
  const { tokens } = await connect(a.cookie, "app:read app:write");
  const args = {
    idempotencyKey: "mcp-key-1",
    name: "From MCP",
    content: { headline: "Engineer" },
  };
  const first = await call(String(tokens.access_token), "create_profile", args);
  const second = await call(
    String(tokens.access_token),
    "create_profile",
    args,
  );
  expect(first.isError).toBe(false);
  expect(second.data.id).toBe(first.data.id);
  expect(
    await env.DB.prepare("SELECT count(*) AS c FROM candidate_profiles").first<{
      c: number;
    }>(),
  ).toMatchObject({ c: 1 });
});

test("a partial profile update keeps fields it did not mention", async () => {
  const a = await account("alice");
  const { tokens } = await connect(a.cookie, "app:read app:write");
  const created = await call(String(tokens.access_token), "create_profile", {
    idempotencyKey: "mcp-key-2",
    name: "Original",
    content: { headline: "Engineer", summary: "Kept" },
  });
  const updated = await call(String(tokens.access_token), "update_profile", {
    profileId: String(created.data.id),
    expectedRevision: Number(created.data.revision),
    content: { headline: "Staff engineer" },
  });
  expect(updated.isError).toBe(false);
  expect(updated.data.content).toMatchObject({
    headline: "Staff engineer",
    summary: "Kept",
  });
});

test("a stale revision conflicts instead of appending another version", async () => {
  const a = await account("alice");
  const { tokens } = await connect(a.cookie, "app:read app:write");
  const created = await call(String(tokens.access_token), "create_profile", {
    idempotencyKey: "mcp-key-3",
    name: "Original",
    content: { headline: "Engineer" },
  });
  const args = {
    profileId: String(created.data.id),
    expectedRevision: Number(created.data.revision),
    name: "Renamed",
  };
  expect(
    (await call(String(tokens.access_token), "update_profile", args)).isError,
  ).toBe(false);
  const stale = await call(String(tokens.access_token), "update_profile", args);
  expect(stale.isError).toBe(true);
  expect(stale.data).toMatchObject({ error: "revision_conflict" });
  const versions = await env.DB.prepare(
    "SELECT count(*) AS c FROM profile_versions",
  ).first<{ c: number }>();
  expect(versions).toMatchObject({ c: 2 });
});

test("pagination is bounded and returns an opaque cursor", async () => {
  const a = await account("alice");
  for (let i = 0; i < 3; i++)
    await seedJob(`job-${i}`, `https://jobs.test/${i}`);
  const { tokens } = await connect(a.cookie, "app:read");
  const page = await call(String(tokens.access_token), "list_jobs", {
    limit: 2,
  });
  expect((page.data.items as unknown[]).length).toBe(2);
  expect(typeof page.data.nextCursor).toBe("string");

  const tooBig = await call(String(tokens.access_token), "list_jobs", {
    limit: 5000,
  });
  expect(tooBig.isError || tooBig.jsonrpcError).toBeTruthy();
});

test("generation returns a queued request and honours its own release gate", async () => {
  const a = await account("alice");
  await seedJob();
  const { tokens } = await connect(a.cookie, "app:read drafts:generate");
  const names = await toolNames(String(tokens.access_token));
  expect(names).toContain("request_draft_generation");
  // GENERATION_ENABLED is false in this environment: a granted scope is not a
  // release, so the request must be refused rather than queued.
  const blocked = await call(
    String(tokens.access_token),
    "request_draft_generation",
    {
      idempotencyKey: "gen-1",
      savedJobId: "missing",
      profileId: "missing",
      profileVersionId: "missing",
      jobVersionId: "missing",
    },
  );
  expect(blocked.isError).toBe(true);
  expect(blocked.data).toMatchObject({ error: "generation_unavailable" });
  expect(
    await env.DB.prepare(
      "SELECT count(*) AS c FROM generation_requests",
    ).first<{
      c: number;
    }>(),
  ).toMatchObject({ c: 0 });
});

test("enabled generation queues a real owned request over MCP transport", async () => {
  const a = await account("alice");
  await seedJob();
  const { tokens } = await connect(
    a.cookie,
    "app:read app:write drafts:generate",
  );
  const access = String(tokens.access_token);
  const profile = await call(access, "create_profile", {
    idempotencyKey: "queued-generation-profile",
    name: "Generation profile",
    content: { headline: "Engineer" },
  });
  await call(access, "activate_profile", { profileId: profile.data.id });
  const saved = await call(access, "save_job", { jobId: "job-1" });
  await env.DB.prepare(
    "INSERT INTO job_versions(id,job_id,revision,content_json,created_at) VALUES('job-1-v1','job-1',1,?,?)",
  )
    .bind(
      JSON.stringify({
        title: "Engineer",
        company: "Example",
        description: "Role",
      }),
      new Date().toISOString(),
    )
    .run();
  const profileVersion = await env.DB.prepare(
    "SELECT id FROM profile_versions WHERE profile_id=? ORDER BY revision DESC LIMIT 1",
  )
    .bind(profile.data.id)
    .first<{ id: string }>();
  const jobVersion = await env.DB.prepare(
    "SELECT id FROM job_versions WHERE job_id='job-1' ORDER BY revision DESC LIMIT 1",
  ).first<{ id: string }>();
  const queued = await call(
    access,
    "request_draft_generation",
    {
      idempotencyKey: "queued-generation-request",
      savedJobId: saved.data.id,
      profileId: profile.data.id,
      profileVersionId: profileVersion?.id,
      jobVersionId: jobVersion?.id,
    },
    {
      ...env,
      GENERATION_ENABLED: "true",
      MCP_GENERATION_ENABLED: "true",
      MCP_WRITES_ENABLED: "true",
    } as AppEnv,
  );
  expect(queued.isError).toBe(false);
  expect(queued.data).toMatchObject({ accepted: true, queued: true });
  expect(
    await env.DB.prepare("SELECT state FROM generation_requests").first(),
  ).toMatchObject({ state: "queued" });
});

test("the installed MCP SDK client completes initialize/listTools and logs schema refusal", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } =
    await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const a = await account("alice");
  const { tokens } = await connect(a.cookie, "app:read app:write");
  const transport = new StreamableHTTPClientTransport(new URL(RESOURCE), {
    requestInit: {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    },
    fetch: (input, init) => SELF.fetch(new Request(input, init)),
  });
  const client = new Client({ name: "installed-sdk-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toContain("list_jobs");
    const lines: string[] = [];
    const original = console.log;
    console.log = (line: string) => lines.push(String(line));
    try {
      const result = await client.callTool({
        name: "save_job",
        arguments: { jobId: "missing", userId: "must-not-enter-log" },
      });
      expect(result.isError).toBe(true);
    } finally {
      console.log = original;
    }
    expect(
      lines
        .map((line) => JSON.parse(line))
        .filter((entry) => entry.event === "mcp_tool_rejected"),
    ).toContainEqual(
      expect.objectContaining({
        event: "mcp_tool_rejected",
        tool: "save_job",
        reason: "invalid_request",
      }),
    );
    expect(lines.join("\n")).not.toContain("must-not-enter-log");
  } finally {
    await client.close();
  }
});

test("the independent write flag still blocks MCP mutations", async () => {
  const { default: app } = await import("../../workers/app/src/index");
  const a = await account("alice");
  await seedJob();
  const { tokens } = await connect(a.cookie, "app:read app:write");
  const response = await app.fetch(
    new Request("https://app.test/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${tokens.access_token}`,
        "MCP-Protocol-Version": MCP_REVISION,
        "Mcp-Method": "tools/call",
        "Mcp-Name": "save_job",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "save_job",
          arguments: { jobId: "job-1" },
          _meta: envelope,
        },
      }),
    }),
    { ...env, WRITES_ENABLED: "false" },
  );
  expect(response.status).toBe(200);
  expect(await response.text()).toContain("writes_disabled");
  expect(
    await env.DB.prepare("SELECT count(*) AS c FROM saved_jobs").first<{
      c: number;
    }>(),
  ).toMatchObject({ c: 0 });
});

test("independent MCP capability flags gate writes, generation and review over transport", async () => {
  const a = await account("alice");
  const { tokens } = await connect(a.cookie, ALL_SCOPES);
  const access = String(tokens.access_token);
  const base = { ...env } as AppEnv;

  const noWrites = await namesWithEnv(access, {
    ...base,
    MCP_WRITES_ENABLED: "false",
  });
  expect(noWrites).toContain("list_jobs");
  expect(noWrites).not.toContain("save_job");

  const noGeneration = await namesWithEnv(access, {
    ...base,
    MCP_GENERATION_ENABLED: "false",
  });
  expect(noGeneration).not.toContain("request_draft_generation");
  expect(noGeneration).toContain("save_job");

  const noReview = await namesWithEnv(access, {
    ...base,
    MCP_REVIEW_ENABLED: "false",
  });
  expect(noReview).not.toContain("approve_draft");
  expect(noReview).toContain("update_draft");
});

// -------------------------------------------------- CSRF must not regress

test("cookie APIs keep rejecting a cross-origin mutation after the MCP exemption", async () => {
  const a = await account("alice");
  expect(
    (
      await request(
        "/api/profiles",
        a.cookie,
        "POST",
        { name: "Profile", content: {} },
        "https://evil.test",
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await request(
        "/auth/sign-in/email",
        undefined,
        "POST",
        { email: a.user.email, password: "Synthetic-password-123!" },
        "https://evil.test",
      )
    ).status,
  ).toBe(403);
  // The consent decision itself is a cookie-backed browser step and keeps the
  // Origin check; only the client-authenticated protocol endpoints are exempt.
  const clientId = String((await registerClient()).client_id);
  const { response } = await authorize(a.cookie, clientId, "app:read");
  const location = response.headers.get("location") ?? "";
  const forged = await SELF.fetch("https://app.test/auth/oauth2/consent", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: a.cookie,
      Origin: "https://evil.test",
    },
    body: JSON.stringify({
      accept: true,
      oauth_query: location.slice(location.indexOf("?") + 1),
    }),
  });
  expect(forged.status).toBe(403);
  expect(
    await env.DB.prepare("SELECT count(*) AS c FROM oauthConsent").first<{
      c: number;
    }>(),
  ).toMatchObject({ c: 0 });
});

// ------------------------------------------------------------ observability

test("structured logs can only carry allowlisted, bounded values", async () => {
  const { logOps } = await import("../../workers/app/src/observability");
  const lines: string[] = [];
  const original = console.log;
  console.log = (line: string) => lines.push(String(line));
  try {
    // A reason outside the closed set, a forged client id and an unregistered
    // tool name are dropped rather than echoed into the log.
    const forged = logOps("mcp_auth_rejected", {
      reason: "Bearer sk-ant-secret-value" as never,
      clientId: "Bearer abc.def; DROP TABLE users",
      tool: "../../etc/passwd",
      status: 401,
    });
    expect(Object.keys(forged).sort()).toEqual(["event", "status"]);

    const good = logOps("mcp_call_completed", {
      clientId: "DqEGaAbFPuUvIHSJanMXkwebzUmtZqgf",
      tool: "list_jobs",
      status: 200,
      durationMs: 12.7,
      count: 3,
    });
    expect(good.clientId).toBe("DqEGaAbFPuUvIHSJanMXkwebzUmtZqgf");
    expect(good.tool).toBe("list_jobs");
    expect(good.durationMs).toBe(12);

    // Over-long ids are refused outright rather than truncated into the log,
    // and a prototype key cannot masquerade as a registered tool.
    expect(
      logOps("mcp_auth_rejected", { clientId: "a".repeat(65) }).clientId,
    ).toBe(undefined);
    expect(logOps("mcp_tool_rejected", { tool: "toString" }).tool).toBe(
      undefined,
    );
  } finally {
    console.log = original;
  }
  for (const line of lines) {
    expect(line).not.toMatch(/sk-ant-|Bearer|passwd|DROP TABLE/);
    expect(line.length).toBeLessThan(300);
    JSON.parse(line);
  }
});

test("a refused MCP call is logged without the token or any record content", async () => {
  const lines: string[] = [];
  const original = console.log;
  console.log = (line: string) => lines.push(String(line));
  try {
    await rpc("sk-ant-not-a-real-token-value-12345", "tools/list");
  } finally {
    console.log = original;
  }
  const rejected = lines.filter((l) => l.includes("mcp_auth_rejected"));
  expect(rejected.length).toBeGreaterThan(0);
  for (const line of rejected) {
    expect(line).not.toContain("sk-ant-");
    expect(JSON.parse(line)).toMatchObject({
      event: "mcp_auth_rejected",
      reason: "missing_or_invalid_token",
      status: 401,
    });
  }
});
