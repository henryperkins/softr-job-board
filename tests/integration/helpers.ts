import { env, SELF, applyD1Migrations, reset } from "cloudflare:test";
import { createAuth } from "../../workers/app/src/auth";
import type { AppEnv } from "../../workers/app/src/env";
import { hashPassword } from "better-auth/crypto";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";
declare global {
  namespace Cloudflare {
    interface Env {
      MIGRATIONS: D1Migration[];
      BETTER_AUTH_SECRET: string;
    }
  }
}
export { env, SELF };
export async function setup() {
  await reset();
  await applyD1Migrations(env.DB, env.MIGRATIONS);
}
export async function account(label: string) {
  const auth = createAuth(env),
    ctx = await auth.$context;
  const user = await ctx.internalAdapter.createUser(
    { name: label, email: `${label}@example.test`, emailVerified: true },
    { method: "email-password" },
  );
  await ctx.internalAdapter.createAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: await hashPassword("Synthetic-password-123!"),
  });
  const response = await SELF.fetch("https://app.test/auth/sign-in/email", {
    method: "POST",
    headers: {
      Origin: "https://app.test",
      "Content-Type": "application/json",
      "CF-Connecting-IP": label === "alice" ? "192.0.2.1" : "192.0.2.2",
    },
    body: JSON.stringify({
      email: user.email,
      password: "Synthetic-password-123!",
    }),
  });
  if (response.status !== 200)
    throw new Error(
      `Sign in failed: ${response.status} ${await response.text()}`,
    );
  const cookie = response.headers.get("set-cookie") ?? "";
  const tokenCookie = cookie.split(";")[0];
  return { user, cookie: tokenCookie, rawCookie: cookie };
}
export async function request(
  path: string,
  cookie?: string,
  method = "GET",
  body?: unknown,
  origin = "https://app.test",
) {
  return SELF.fetch(`https://app.test${path}`, {
    method,
    headers: {
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
export async function seedJob(
  id = "job-1",
  sourceUrl = "https://jobs.example.test/1",
) {
  const t = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO jobs(id,title,company,source_url,created_at,updated_at,legacy_id) VALUES(?,?,?,?,?,?,?)",
  )
    .bind(id, "Engineer", "Example", sourceUrl, t, t, `legacy-${id}`)
    .run();
}
export async function json<T>(r: Response) {
  return r.json() as Promise<T>;
}
