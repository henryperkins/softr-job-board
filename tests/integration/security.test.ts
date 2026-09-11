import { beforeEach, expect, test } from "vitest";
import { SELF, setup, account, request, env, seedJob, json } from "./helpers";
import app from "../../workers/app/src/index";
beforeEach(setup);
test("rejected verification resend has identical acknowledgment for unverified and absent accounts while validation stays an error", async () => {
  const a = await account("alice");
  await env.DB.prepare("UPDATE auth_user SET emailVerified=0 WHERE id=?")
    .bind(a.user.id)
    .run();
  let attempts = 0;
  const resend = (email: string) =>
    app.fetch(
      new Request("https://app.test/auth/send-verification-email", {
        method: "POST",
        headers: {
          Origin: "https://app.test",
          "Content-Type": "application/json",
          "CF-Connecting-IP": "192.0.2.80",
        },
        body: JSON.stringify({ email }),
      }),
      {
        ...env,
        MAIL_MODE: "cloudflare",
        MAIL_FROM: "noreply@example.test",
        EMAIL: {
          send: () => {
            attempts++;
            return Promise.reject(new Error("private resend provider error"));
          },
        },
      },
    );
  const existing = await resend("alice@example.test"),
    absent = await resend("absent@example.test");
  expect(existing.status).toBe(202);
  expect(absent.status).toBe(existing.status);
  expect(await existing.json()).toEqual(await absent.json());
  expect(existing.headers.get("set-cookie")).toBeNull();
  expect(attempts).toBe(1);
  expect((await resend("not-an-email")).status).toBe(400);
  expect(attempts).toBe(1);
  expect(
    await env.DB.prepare("SELECT emailVerified FROM auth_user WHERE id=?")
      .bind(a.user.id)
      .first("emailVerified"),
  ).toBe(0);
  const audit = await env.DB.prepare("SELECT * FROM audit_events").all();
  expect(audit.results).toHaveLength(2);
  expect(
    audit.results.filter((row) => row.action === "mail_delivery_failed"),
  ).toHaveLength(1);
  expect(
    audit.results.filter((row) => row.action === "mail_request_received"),
  ).toHaveLength(1);
  expect(JSON.stringify(audit.results)).not.toMatch(
    /alice|absent|example.test|private resend|token|password/i,
  );
});
test("configured signup transport rejection acknowledges only receipt and records redacted failure", async () => {
  const response = await app.fetch(
    new Request("https://app.test/auth/sign-up/email", {
      method: "POST",
      headers: {
        Origin: "https://app.test",
        "Content-Type": "application/json",
        "CF-Connecting-IP": "192.0.2.77",
      },
      body: JSON.stringify({
        name: "New user",
        email: "new@example.test",
        password: "Synthetic-password-123!",
      }),
    }),
    {
      ...env,
      MAIL_MODE: "cloudflare",
      MAIL_FROM: "noreply@example.test",
      EMAIL: {
        send: () =>
          Promise.reject(new Error("provider details must not escape")),
      },
    },
  );
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({
    status: true,
    message:
      "Request received. Email delivery is attempted for eligible accounts; delivery is not confirmed.",
  });
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(
    await env.DB.prepare("SELECT emailVerified FROM auth_user WHERE email=?")
      .bind("new@example.test")
      .first("emailVerified"),
  ).toBe(0);
  const audit = await env.DB.prepare("SELECT * FROM audit_events").all();
  expect(audit.results).toHaveLength(1);
  expect(audit.results[0].action).toBe("mail_delivery_failed");
  expect(JSON.stringify(audit.results)).not.toMatch(
    /new@example|provider details|token|password/i,
  );
});
test("rejected reset transport produces the same public acknowledgment for existing and absent accounts", async () => {
  await account("alice");
  let attempts = 0;
  const reset = (email: string) =>
    app.fetch(
      new Request("https://app.test/auth/request-password-reset", {
        method: "POST",
        headers: {
          Origin: "https://app.test",
          "Content-Type": "application/json",
          "CF-Connecting-IP": "192.0.2.78",
        },
        body: JSON.stringify({ email }),
      }),
      {
        ...env,
        MAIL_MODE: "cloudflare",
        MAIL_FROM: "noreply@example.test",
        EMAIL: {
          send: () => {
            attempts++;
            return Promise.reject(new Error("private provider failure"));
          },
        },
      },
    );
  const existing = await reset("alice@example.test"),
    absent = await reset("absent@example.test");
  expect(existing.status).toBe(202);
  expect(absent.status).toBe(existing.status);
  expect(await existing.json()).toEqual(await absent.json());
  expect(attempts).toBe(1);
  const events = await env.DB.prepare(
    "SELECT action,entity_type FROM audit_events ORDER BY created_at,id",
  ).all();
  expect(
    events.results.filter((event) => event.action === "mail_delivery_failed"),
  ).toHaveLength(1);
  expect(
    events.results.filter((event) => event.action === "mail_request_received"),
  ).toHaveLength(1);
});
test("mail outcome is request scoped and retry after restored transport does not retain a failure", async () => {
  await account("alice");
  const reset = (send: SendEmail["send"]) =>
    app.fetch(
      new Request("https://app.test/auth/request-password-reset", {
        method: "POST",
        headers: {
          Origin: "https://app.test",
          "Content-Type": "application/json",
          "CF-Connecting-IP": "192.0.2.79",
        },
        body: JSON.stringify({ email: "alice@example.test" }),
      }),
      {
        ...env,
        MAIL_MODE: "cloudflare",
        MAIL_FROM: "noreply@example.test",
        EMAIL: { send },
      },
    );
  const responses = await Promise.all([
    reset(() => Promise.reject(new Error("synthetic transport rejection"))),
    reset(() => Promise.resolve({ messageId: "synthetic-only" })),
  ]);
  expect(responses.map((response) => response.status)).toEqual([202, 202]);
  expect(await responses[0].json()).toEqual(await responses[1].json());
  expect(
    (await reset(() => Promise.resolve({ messageId: "synthetic-retry" })))
      .status,
  ).toBe(202);
  expect(
    await env.DB.prepare(
      "SELECT count(*) FROM audit_events WHERE action='mail_delivery_failed'",
    ).first("count(*)"),
  ).toBe(1);
  expect(
    await env.DB.prepare(
      "SELECT count(*) FROM audit_events WHERE action='mail_request_received'",
    ).first("count(*)"),
  ).toBe(2);
});
test("distinct Cloudflare IP addresses receive independent sign-in quotas and X-Forwarded-For cannot choose them", async () => {
  const signIn = (ip: string, forwarded: string) =>
    SELF.fetch("https://app.test/auth/sign-in/email", {
      method: "POST",
      headers: {
        Origin: "https://app.test",
        "Content-Type": "application/json",
        "CF-Connecting-IP": ip,
        "X-Forwarded-For": forwarded,
      },
      body: JSON.stringify({
        email: "absent@example.test",
        password: "wrong-password",
      }),
    });
  for (let i = 0; i < 10; i++)
    expect((await signIn("192.0.2.70", `198.51.100.${i}`)).status).toBe(401);
  expect((await signIn("192.0.2.70", "198.51.100.200")).status).toBe(429);
  expect((await signIn("192.0.2.71", "198.51.100.0")).status).toBe(401);
  const rows = await env.DB.prepare(
    "SELECT key,count FROM auth_rate_limit",
  ).all<{ key: string; count: number }>();
  expect(rows.results.some((row) => row.key.includes("192.0.2.70"))).toBe(true);
  expect(rows.results.some((row) => row.key.includes("192.0.2.71"))).toBe(true);
  expect(rows.results.some((row) => row.key.includes("198.51.100."))).toBe(
    false,
  );
});
test("unverified accounts cannot sign in and rate limits persist in D1", async () => {
  const a = await account("alice");
  await env.DB.prepare("UPDATE auth_user SET emailVerified=0 WHERE id=?")
    .bind(a.user.id)
    .run();
  expect((await request("/api/session", a.cookie)).status).toBe(401);
  expect(
    (
      await request("/auth/sign-in/email", undefined, "POST", {
        email: a.user.email,
        password: "Synthetic-password-123!",
      })
    ).status,
  ).toBe(403);
  let response: Response | undefined;
  for (let i = 0; i < 11; i++)
    response = await SELF.fetch("https://app.test/auth/sign-in/email", {
      method: "POST",
      headers: {
        Origin: "https://app.test",
        "Content-Type": "application/json",
        "CF-Connecting-IP": "192.0.2.99",
      },
      body: JSON.stringify({
        email: "absent@example.test",
        password: "wrong-password",
      }),
    });
  expect(response?.status).toBe(429);
  expect(
    Number(
      await env.DB.prepare("SELECT count(*) FROM auth_rate_limit").first(
        "count(*)",
      ),
    ),
  ).toBeGreaterThan(0);
});
test("auth and metadata paths never fall back to HTML, and private shell redirects", async () => {
  for (const path of [
    "/auth/unknown",
    "/.well-known/unknown",
    "/mcp/unknown",
  ]) {
    const response = await SELF.fetch(`https://app.test${path}`);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.headers.get("content-type") ?? "").not.toContain(
      "text/html",
    );
  }
  const response = await SELF.fetch("https://app.test/profile", {
    redirect: "manual",
  });
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("/login?next-page=%2Fprofile");
});
test("business writes fail with disabled flag while reads and auth remain independent", async () => {
  const a = await account("alice");
  const response = await app.fetch(
    new Request("https://app.test/api/profiles", {
      method: "POST",
      headers: {
        Origin: "https://app.test",
        Cookie: a.cookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "blocked", content: {} }),
    }),
    { ...env, WRITES_ENABLED: "false" },
  );
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "writes_disabled" });
  expect(
    await env.DB.prepare("SELECT count(*) FROM candidate_profiles").first(
      "count(*)",
    ),
  ).toBe(0);
});
test("anonymous API is rejected", async () => {
  expect((await SELF.fetch("https://app.test/api/session")).status).toBe(401);
});
test("unknown API never becomes HTML", async () => {
  const r = await SELF.fetch("https://app.test/api/unknown");
  expect(r.status).toBe(404);
  expect(r.headers.get("content-type")).toContain("application/json");
});
test("real password sign-in yields a secure session, rejects wrong password, and logout revokes it", async () => {
  const a = await account("alice");
  expect(a.rawCookie).toMatch(/HttpOnly/i);
  expect(a.rawCookie).toMatch(/Secure/i);
  expect(a.rawCookie).toMatch(/SameSite=Lax/i);
  expect((await request("/api/session", a.cookie)).status).toBe(200);
  expect(
    (
      await request("/auth/sign-in/email", undefined, "POST", {
        email: a.user.email,
        password: "wrong-password",
      })
    ).status,
  ).toBe(401);
  expect((await request("/auth/sign-out", a.cookie, "POST", {})).status).toBe(
    200,
  );
  expect((await request("/api/session", a.cookie)).status).toBe(401);
});
test("revoked and expired database sessions are rejected without cookie caching", async () => {
  const a = await account("alice");
  await env.DB.prepare("UPDATE auth_session SET expiresAt=? WHERE userId=?")
    .bind(0, a.user.id)
    .run();
  expect((await request("/api/session", a.cookie)).status).toBe(401);
  const b = await account("bob");
  await env.DB.prepare("DELETE FROM auth_session WHERE userId=?")
    .bind(b.user.id)
    .run();
  expect((await request("/api/session", b.cookie)).status).toBe(401);
});
test("mail-disabled signup and recovery fail honestly before account creation", async () => {
  for (const path of [
    "/auth/sign-up/email",
    "/auth/request-password-reset",
    "/auth/send-verification-email",
  ])
    expect(
      (
        await request(path, undefined, "POST", {
          email: "nobody@example.test",
          name: "Nobody",
          password: "Synthetic-password-123!",
        })
      ).status,
    ).toBe(503);
  expect(
    await env.DB.prepare("SELECT count(*) AS n FROM auth_user").first("n"),
  ).toBe(0);
});
test("origins and forged ownership fields fail closed", async () => {
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
  expect(
    (
      await request("/api/profiles", a.cookie, "POST", {
        name: "Profile",
        content: {},
        userId: "victim",
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await request("/api/profiles", a.cookie, "POST", {
        name: "Profile",
        content: { attachmentId: "victim" },
      })
    ).status,
  ).toBe(400);
});
test("two authenticated users cannot list, read, mutate, or activate each others profiles and saves", async () => {
  const a = await account("alice"),
    b = await account("bob");
  const p = await json<{ id: string }>(
    await request("/api/profiles", a.cookie, "POST", {
      name: "Alice",
      content: { summary: "private" },
    }),
  );
  expect(
    (await json<{ items: unknown[] }>(await request("/api/profiles", b.cookie)))
      .items,
  ).toEqual([]);
  for (const [method, tail, body] of [
    ["GET", "", undefined],
    ["PATCH", "", { expectedRevision: 1, name: "intrusion" }],
    ["POST", "/activate", {}],
  ] as const)
    expect(
      (await request(`/api/profiles/${p.id}${tail}`, b.cookie, method, body))
        .status,
    ).toBe(404);
  await seedJob();
  const s = await json<{ id: string }>(
    await request("/api/saved-jobs", a.cookie, "POST", { jobId: "job-1" }),
  );
  expect(
    (
      await json<{ items: unknown[] }>(
        await request("/api/saved-jobs", b.cookie),
      )
    ).items,
  ).toEqual([]);
  expect((await request(`/api/saved-jobs/${s.id}`, b.cookie)).status).toBe(404);
  expect(
    (
      await request(`/api/saved-jobs/${s.id}`, b.cookie, "PATCH", {
        expectedRevision: 1,
        notes: "intrusion",
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await request("/api/saved-jobs", a.cookie, "POST", {
        jobId: "job-1",
        userId: "victim",
      })
    ).status,
  ).toBe(400);
});
test("identity initialization never claims an imported user by matching email", async () => {
  const stamp = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO users(id,email,created_at,updated_at) VALUES(?,?,?,?)",
  )
    .bind("legacy-owner", "alice@example.test", stamp, stamp)
    .run();
  const a = await account("alice");
  const session = await json<{ user: { id: string } }>(
    await request("/api/session", a.cookie),
  );
  expect(session.user.id).not.toBe("legacy-owner");
  await request("/api/session", a.cookie);
  expect(
    await env.DB.prepare("SELECT count(*) FROM auth_identities WHERE subject=?")
      .bind(a.user.id)
      .first("count(*)"),
  ).toBe(1);
});
test("two authenticated users cannot read or change others drafts or download their files", async () => {
  const a = await account("alice"),
    b = await account("bob");
  const actor = await json<{ user: { id: string } }>(
    await request("/api/session", a.cookie),
  );
  await seedJob();
  const s = await json<{ id: string }>(
    await request("/api/saved-jobs", a.cookie, "POST", { jobId: "job-1" }),
  );
  await env.DB.prepare(
    "INSERT INTO draft_applications(id,user_id,saved_job_id,status,cover_letter,created_at,updated_at) VALUES('draft',?,?,'Ready for Review','private letter','x','x')",
  )
    .bind(actor.user.id, s.id)
    .run();
  await env.DB.prepare(
    "INSERT INTO draft_versions(id,draft_id,user_id,revision,cover_letter,status,created_at) VALUES('v1','draft',?,1,'private letter','Ready for Review','x')",
  )
    .bind(actor.user.id)
    .run();
  for (const [method, tail, body] of [
    ["GET", "", undefined],
    ["PATCH", "", { expectedRevision: 1, coverLetter: "intrusion" }],
    ["POST", "/approve", { expectedRevision: 1 }],
  ] as const)
    expect(
      (await request(`/api/drafts/draft${tail}`, b.cookie, method, body))
        .status,
    ).toBe(404);
  expect(
    (
      await request("/api/drafts/draft/approve", a.cookie, "POST", {
        expectedRevision: 1,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await request("/api/drafts/draft", a.cookie, "PATCH", {
        expectedRevision: 1,
        coverLetter: "stale",
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await request("/api/drafts/draft", a.cookie, "PATCH", {
        expectedRevision: 2,
        coverLetter: "edited",
      })
    ).status,
  ).toBe(200);
  expect(
    await env.DB.prepare(
      "SELECT cover_letter FROM draft_versions WHERE draft_id='draft' AND revision=2",
    ).first("cover_letter"),
  ).toBe("private letter");
  expect(
    await (await request(`/api/saved-jobs/${s.id}`, a.cookie)).json(),
  ).toMatchObject({ draft: { id: "draft", status: "Needs Edits" } });
  await env.PRIVATE_FILES.put("owned-file", "secret");
  await env.DB.prepare(
    "INSERT INTO attachments(id,user_id,draft_id,object_key,filename,media_type,size_bytes,checksum_sha256,status,scan_status,created_at) VALUES('file',?,'draft','owned-file','unsafe.html','text/html',6,'synthetic','available','clean','x')",
  )
    .bind(actor.user.id)
    .run();
  expect(
    (await request("/api/attachments/file/download", b.cookie)).status,
  ).toBe(404);
  const file = await request("/api/attachments/file/download", a.cookie);
  expect(file.status).toBe(200);
  expect(file.headers.get("content-disposition")).toContain("attachment");
  expect(file.headers.get("cache-control")).toBe("no-store");
  expect(file.headers.get("x-content-type-options")).toBe("nosniff");
  expect(file.headers.get("content-type")).toBe("application/octet-stream");
  expect(new TextDecoder().decode(await file.arrayBuffer())).toBe("secret");
  await env.DB.prepare(
    "UPDATE attachments SET scan_status='pending' WHERE id='file'",
  ).run();
  expect(
    (await request("/api/attachments/file/download", a.cookie)).status,
  ).toBe(409);
});
