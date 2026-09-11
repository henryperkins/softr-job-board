import { createAuthEndpoint, APIError } from "better-auth/api";
import { getOAuthProviderApi } from "@better-auth/oauth-provider";
import type { OAuthOptions, Scope } from "@better-auth/oauth-provider";
import { isCurrentGrantAccessToken } from "../oauth-grants";

export type McpTokenInfo = {
  subject: string;
  clientId: string;
  scopes: string[];
  audiences: string[];
  expiresAt: number | null;
};

function toList(value: unknown): string[] {
  if (typeof value === "string") return value.split(" ").filter(Boolean);
  if (Array.isArray(value)) return value.filter((v) => typeof v === "string");
  return [];
}

/**
 * Companion plugin that turns a bearer access token into the grant it actually
 * represents *right now*.
 *
 * `requireActiveAccessToken` is the provider's own protected-resource check: for
 * the opaque access tokens this server issues it reads the stored token and
 * rejects one that has been revoked, expired, or whose session ended. That is
 * the difference between a truthful "disconnect this app" button and a decorative
 * one — verifying a signature could never observe a revoked grant.
 *
 * The route is registered under Better Auth's base path but is blocked at the
 * HTTP edge, so it is reachable only through a direct server-side `auth.api`
 * call from this Worker.
 */
export function mcpResourceServerPlugin(
  options: OAuthOptions<Scope[]>,
  db: D1Database,
) {
  return {
    id: "mcp-resource-server",
    endpoints: {
      mcpTokenInfo: createAuthEndpoint(
        "/mcp-token-info",
        { method: "GET" },
        async (ctx) => {
          const header =
            ctx.headers?.get("authorization") ??
            ctx.request?.headers.get("authorization") ??
            "";
          const token = /^Bearer\s+(.+)$/i.exec(header.trim())?.[1];
          if (!token)
            throw new APIError("UNAUTHORIZED", { message: "invalid_token" });
          const provider = getOAuthProviderApi(ctx, options);
          const claims = await provider.requireActiveAccessToken(token);
          if (!(await isCurrentGrantAccessToken(db, token)))
            throw new APIError("UNAUTHORIZED", { message: "invalid_token" });
          const info: McpTokenInfo = {
            subject: typeof claims.sub === "string" ? claims.sub : "",
            clientId:
              typeof (claims as Record<string, unknown>).client_id === "string"
                ? ((claims as Record<string, unknown>).client_id as string)
                : "",
            scopes: toList(
              (claims as Record<string, unknown>).scope ??
                (claims as Record<string, unknown>).scopes,
            ),
            audiences: toList(claims.aud),
            expiresAt: typeof claims.exp === "number" ? claims.exp : null,
          };
          return info;
        },
      ),
    },
  };
}
