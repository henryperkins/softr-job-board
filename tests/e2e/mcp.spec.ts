import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { accounts } from "./synthetic-accounts.mjs";

const port = process.env.SYNTHETIC_PORT ?? "8787";
const origin = `http://localhost:${port}`;
const resource = `${origin}/mcp`;
const redirectUri = "https://client.test/callback";
const scope = "offline_access app:read app:write";
const evidence = resolve(
  import.meta.dirname,
  "../../../../work/task-7-browser",
);
mkdirSync(evidence, { recursive: true });

test.skip(
  process.env.SYNTHETIC_MCP !== "true",
  "MCP browser acceptance needs an explicitly enabled isolated local harness",
);

function pkce() {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

async function login(page: Page) {
  await page.getByLabel("Email address").fill(accounts[0].email);
  await page.getByLabel("Password", { exact: true }).fill(accounts[0].password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

async function registerClient(request: APIRequestContext) {
  const response = await request.post("/auth/oauth2/register", {
    data: {
      client_name: "Synthetic browser assistant",
      client_uri: "https://client.test/about",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope,
    },
  });
  expect(response.status()).toBe(201);
  return String((await response.json()).client_id);
}

async function openConsent(page: Page, clientId: string, signedOut = false) {
  const proof = pkce();
  const authorize = new URL("/auth/oauth2/authorize", origin);
  for (const [key, value] of Object.entries({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
    state: randomBytes(12).toString("hex"),
    code_challenge: proof.challenge,
    code_challenge_method: "S256",
    resource,
  }))
    authorize.searchParams.set(key, value);

  await page.goto(authorize.toString());
  if (signedOut) {
    await expect(page).toHaveURL(/\/login\?.*sig=/);
    const signedQuery = new URL(page.url()).search;
    const signup = page.getByRole("link", { name: "Create an account" });
    await expect(signup).toHaveAttribute("href", `/sign-up${signedQuery}`);
    await login(page);
  }
  await expect(page).toHaveURL(/\/consent\?/);
  await expect(
    page.getByRole("heading", { name: "Allow access?" }),
  ).toBeVisible();
  await expect(
    page.getByText("Synthetic browser assistant", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("app:read", { exact: false })).toBeVisible();
  await expect(page.getByText("app:write", { exact: false })).toBeVisible();
  await expect(
    page.getByText("have not been verified", { exact: false }),
  ).toBeVisible();
  return proof.verifier;
}

async function decide(page: Page, button: "Allow" | "Deny") {
  const callback = page.waitForURL(
    (url) => url.origin === "https://client.test",
  );
  await page.getByRole("button", { name: `${button} access` }).click();
  await callback;
  return new URL(page.url());
}

async function exchange(
  request: APIRequestContext,
  clientId: string,
  code: string,
  verifier: string,
) {
  const response = await request.post("/auth/oauth2/token", {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    data: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      resource,
    }).toString(),
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as { access_token: string };
}

async function listTools(request: APIRequestContext, accessToken: string) {
  const response = await request.post("/mcp", {
    headers: {
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": "tools/list",
    },
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": {
            name: "synthetic-browser-client",
            version: "1.0",
          },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    },
  });
  return { status: response.status(), text: await response.text() };
}

test.beforeEach(async ({ context, page }) => {
  await context.setExtraHTTPHeaders({ "CF-Connecting-IP": "192.0.2.77" });
  await page.route("https://client.test/callback**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/plain",
      body: "OAuth callback received",
    }),
  );
});

test("consent, MCP access, account disconnect and re-consent preserve revocation", async ({
  page,
  playwright,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().startsWith("Failed to load resource:")
    )
      errors.push(message.text());
  });

  const protocol = await playwright.request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { "CF-Connecting-IP": "192.0.2.78" },
  });
  const clientId = await registerClient(protocol);

  await openConsent(page, clientId, true);
  await page.screenshot({
    path: resolve(evidence, "consent-desktop.png"),
    fullPage: true,
  });
  const denied = await decide(page, "Deny");
  expect(denied.searchParams.get("error")).toBe("access_denied");
  expect(denied.searchParams.get("code")).toBeNull();

  const firstVerifier = await openConsent(page, clientId);
  const firstCallback = await decide(page, "Allow");
  const firstCode = firstCallback.searchParams.get("code");
  expect(firstCode).toBeTruthy();
  const first = await exchange(protocol, clientId, firstCode!, firstVerifier);
  const firstTools = await listTools(protocol, first.access_token);
  expect(firstTools.status).toBe(200);
  expect(firstTools.text).toContain("list_jobs");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/account");
  await expect(
    page.getByRole("heading", { name: "Connected applications" }),
  ).toBeVisible();
  await expect(
    page.getByText("Synthetic browser assistant", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: resolve(evidence, "connected-app-mobile.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Disconnect Synthetic browser assistant" })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "existing access stopped immediately" }),
  ).toBeVisible();
  await expect(page.getByText("No applications are connected.")).toBeVisible();
  await page.screenshot({
    path: resolve(evidence, "disconnected-mobile.png"),
    fullPage: true,
  });

  expect((await listTools(protocol, first.access_token)).status).toBe(401);

  const secondVerifier = await openConsent(page, clientId);
  const secondCallback = await decide(page, "Allow");
  const secondCode = secondCallback.searchParams.get("code");
  expect(secondCode).toBeTruthy();
  const second = await exchange(
    protocol,
    clientId,
    secondCode!,
    secondVerifier,
  );
  expect(second.access_token).not.toBe(first.access_token);
  expect((await listTools(protocol, second.access_token)).status).toBe(200);
  expect((await listTools(protocol, first.access_token)).status).toBe(401);

  expect(await page.locator("vite-error-overlay").count()).toBe(0);
  expect(errors).toEqual([]);
  await protocol.dispose();
});
