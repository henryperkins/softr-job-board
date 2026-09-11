import { betterAuth } from "better-auth";
import { mcp } from "@better-auth/mcp";
import { mcpResourceServerPlugin } from "./mcp/resource-server";
import { MCP_ADVERTISED_SCOPES } from "../../../packages/domain/src/mcp";
import { oauthTokenHash, recordAuthorizationIntent } from "./oauth-grants";
import type { AppEnv } from "./env";

// RFC 8707 / RFC 9728 canonical resource identifier for this MCP server. Issued
// tokens are audience-bound to it. HTTPS is required except on loopback, which
// keeps local development working without weakening a deployed origin.
export function mcpResource(env: AppEnv) {
  return new URL("/mcp", env.APP_ORIGIN).toString();
}

export function mcpAvailable(env: AppEnv) {
  return env.MCP_ENABLED === "true";
}

export function mailAvailable(env: AppEnv) {
  return (
    env.MAIL_MODE === "cloudflare" &&
    !!env.EMAIL &&
    !!env.MAIL_FROM &&
    new URL(env.APP_ORIGIN).protocol === "https:"
  );
}
export function createAuth(env: AppEnv, onMailFailure?: () => void) {
  const send = async (to: string, subject: string, url: string) => {
    try {
      if (!mailAvailable(env) || !env.EMAIL)
        throw new Error("MAIL_UNAVAILABLE");
      await env.EMAIL.send({
        from: env.MAIL_FROM,
        to,
        subject,
        text: `Open this link to continue: ${url}`,
      });
    } catch {
      // Better Auth catches awaited callback rejection. Preserve only a request-local
      // failure signal for the HTTP boundary, never the provider error or mail data.
      onMailFailure?.();
      throw new Error("MAIL_UNAVAILABLE");
    }
  };
  const oauthOptions = mcpOauthOptions(env);
  return betterAuth({
    database: env.DB,
    baseURL: env.APP_ORIGIN,
    basePath: "/auth",
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.APP_ORIGIN],
    user: { modelName: "auth_user" },
    account: { modelName: "auth_account", accountLinking: { enabled: false } },
    verification: { modelName: "auth_verification" },
    session: {
      modelName: "auth_session",
      expiresIn: 60 * 60 * 24 * 7,
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "auth_rate_limit",
      window: 60,
      max: 60,
      customRules: { "/sign-in/email": { window: 60, max: 10 } },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) =>
        send(user.email, "Reset your password", url),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: false,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) =>
        send(user.email, "Verify your email", url),
    },
    advanced: {
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      useSecureCookies: new URL(env.APP_ORIGIN).protocol === "https:",
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
    },
    logger: { disabled: true },
    telemetry: { enabled: false },
    databaseHooks: {
      session: {
        create: {
          after: async (session, context) => {
            const body = context?.body as Record<string, unknown> | undefined;
            if (typeof body?.oauth_query === "string")
              await recordAuthorizationIntent(
                env.DB,
                session.userId,
                session.id,
                body.oauth_query,
              );
          },
        },
      },
    },
    plugins: [
      mcp(oauthOptions),
      // Shares the exact same options object, so the resource server can never
      // validate against a different resource, scope set or token format than
      // the authorization server issues.
      mcpResourceServerPlugin(oauthOptions, env.DB),
    ],
  });
}

export function mcpOauthOptions(env: AppEnv) {
  return {
    resource: mcpResource(env),
    loginPage: "/login",
    consentPage: "/consent",
    // Opaque access tokens, deliberately. A JWT access token is never stored,
    // so it cannot be revoked server side: signature validation alone would
    // keep honouring a token after the user disconnects the app. Opaque tokens
    // live in oauthAccessToken and are deleted on revoke, which is what makes
    // the connected-apps screen truthful.
    disableJwtPlugin: true,
    // Strict rotation: any reuse of a rotated refresh token is replay and
    // invalidates its family. MCP's otherwise-helpful 30 second retry window is
    // deliberately disabled for this user data boundary.
    refreshTokenReuseInterval: 0,
    // Keep the provider and our epoch/resource checks on one maintained hash.
    storeTokens: { hash: (token: string) => oauthTokenHash(token) },
    scopes: [...MCP_ADVERTISED_SCOPES],
    // MCP clients arrive without pre-registration and have no initial access
    // token, so registration is open but rate limited by the plugin's own
    // limits and never grants skipped consent for an arbitrary client.
    allowDynamicClientRegistration: true,
    allowUnauthenticatedClientRegistration: true,
  };
}
