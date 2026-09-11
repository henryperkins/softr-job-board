import { beforeEach, expect, test } from "vitest";
import { setup, account, request, env, seedJob } from "./helpers";
import app from "../../workers/app/src/index";
import { GenerationService } from "../../packages/data/src/generation";
beforeEach(setup);
test("authenticated generation API accepts queued intent, persists owner status, and leaves drafts unapproved", async () => {
  const a = await account("alice"),
    b = await account("bob");
  await seedJob();
  await env.DB.prepare(
    "INSERT INTO job_versions(id,job_id,revision,content_json,created_at) VALUES('jv','job-1',1,'{\"title\":\"Engineer\"}','t')",
  ).run();
  const session = (await (await request("/api/session", a.cookie)).json()) as {
    user: { id: string; name: string; email: string };
  };
  const data = new GenerationService(env.DB, session.user);
  const p = await data.createProfile({
      name: "Selected",
      content: { summary: "I build software." },
    }),
    s = await data.createSave("job-1");
  const v = await env.DB.prepare(
    "SELECT id FROM profile_versions WHERE profile_id=?",
  )
    .bind(p.id)
    .first<string>("id");
  const input = {
    savedJobId: s.id,
    profileId: p.id,
    profileVersionId: v!,
    jobVersionId: "jv",
    idempotencyKey: "api-once",
  };
  const post = (cookie: string, extra: Record<string, unknown> = {}) =>
    app.fetch(
      new Request("https://app.test/api/generation-requests", {
        method: "POST",
        headers: {
          Origin: "https://app.test",
          Cookie: cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...input, ...extra }),
      }),
      { ...env, GENERATION_ENABLED: "true" },
    );
  expect(
    (await request("/api/generation-requests", a.cookie, "POST", input)).status,
  ).toBe(503);
  expect(
    (await request("/api/generation-requests", undefined, "POST", input))
      .status,
  ).toBe(401);
  expect((await post(b.cookie)).status).toBe(404);
  expect((await post(a.cookie, { model: "caller-controlled" })).status).toBe(
    400,
  );
  const response = await post(a.cookie);
  expect(response.status).toBe(202);
  const accepted = (await response.json()) as {
    id: string;
    state: string;
    draftId: string;
  };
  expect(accepted.state).toBe("queued");
  expect((await post(a.cookie)).status).toBe(202);
  expect(
    (await request("/api/generation-requests/" + accepted.id, b.cookie)).status,
  ).toBe(404);
  const status = (await (
    await request("/api/generation-requests/" + accepted.id, a.cookie)
  ).json()) as Record<string, unknown>;
  expect(status.state).toBe("queued");
  expect(status).not.toHaveProperty("snapshot_key");
  expect((await data.getDraft(accepted.draftId)).approvedRevision).toBeNull();
  expect(
    (
      await request("/api/drafts/" + accepted.draftId, a.cookie, "PATCH", {
        expectedRevision: 1,
        coverLetter: "Edited while queued",
      })
    ).status,
  ).toBe(200);
});
