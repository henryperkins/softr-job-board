import { beforeEach, expect, test } from "vitest";
import { account, env, json, request, seedJob, setup } from "./helpers";
beforeEach(setup);
test("failed audit insert rolls back profile mutation and snapshot as one D1 batch", async () => {
  const a = await account("alice");
  const p = await json<{ id: string }>(
    await request("/api/profiles", a.cookie, "POST", {
      name: "Before",
      content: {},
    }),
  );
  await env.DB.exec(
    "CREATE TRIGGER reject_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT,'test_audit_failure'); END;",
  );
  const response = await request(`/api/profiles/${p.id}`, a.cookie, "PATCH", {
    expectedRevision: 1,
    name: "After",
  });
  expect(response.status).toBe(500);
  expect(
    await (await request(`/api/profiles/${p.id}`, a.cookie)).json(),
  ).toMatchObject({ name: "Before", revision: 1 });
  expect(
    await env.DB.prepare(
      "SELECT count(*) FROM profile_versions WHERE profile_id=?",
    )
      .bind(p.id)
      .first("count(*)"),
  ).toBe(1);
});
test("simultaneous profile edits commit one revision and reject the other", async () => {
  const a = await account("alice");
  const p = await json<{ id: string }>(
    await request("/api/profiles", a.cookie, "POST", {
      name: "Before",
      content: {},
    }),
  );
  const responses = await Promise.all(
    ["A", "B"].map((name) =>
      request(`/api/profiles/${p.id}`, a.cookie, "PATCH", {
        expectedRevision: 1,
        name,
      }),
    ),
  );
  expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(
    await env.DB.prepare(
      "SELECT count(*) FROM profile_versions WHERE profile_id=?",
    )
      .bind(p.id)
      .first("count(*)"),
  ).toBe(2);
});
test("profile edit merges imported fields, keeps immutable snapshots, and enforces optimistic concurrency", async () => {
  const a = await account("alice");
  const p = await json<{ id: string }>(
    await request("/api/profiles", a.cookie, "POST", {
      name: "Alice",
      content: { summary: "old", skills: ["SQL"] },
    }),
  );
  await env.DB.prepare(
    "UPDATE candidate_profiles SET content_json=json_set(content_json,'$.resumeAttachmentId','private-file') WHERE id=?",
  )
    .bind(p.id)
    .run();
  const updated = await request(`/api/profiles/${p.id}`, a.cookie, "PATCH", {
    expectedRevision: 1,
    content: { summary: "new" },
  });
  expect(updated.status).toBe(200);
  expect(await updated.json()).toMatchObject({
    revision: 2,
    content: {
      summary: "new",
      skills: ["SQL"],
      resumeAttachmentId: "private-file",
    },
  });
  expect(
    (
      await request(`/api/profiles/${p.id}`, a.cookie, "PATCH", {
        expectedRevision: 1,
        name: "stale",
      })
    ).status,
  ).toBe(409);
  expect(
    await env.DB.prepare(
      "SELECT COUNT(*) FROM profile_versions WHERE profile_id=?",
    )
      .bind(p.id)
      .first("COUNT(*)"),
  ).toBe(2);
  await expect(
    env.DB.prepare("UPDATE profile_versions SET name=? WHERE profile_id=?")
      .bind("tamper", p.id)
      .run(),
  ).rejects.toThrow("immutable_version");
  expect(
    (await request(`/api/profiles/${p.id}/activate`, a.cookie, "POST", {}))
      .status,
  ).toBe(200);
  expect(await (await request("/api/profiles", a.cookie)).json()).toMatchObject(
    { activeProfileId: p.id },
  );
});
test("duplicate saves are idempotent and only one audited create is committed", async () => {
  const a = await account("alice");
  await seedJob();
  const one = await json<{ id: string }>(
      await request("/api/saved-jobs", a.cookie, "POST", { jobId: "job-1" }),
    ),
    two = await json<{ id: string }>(
      await request("/api/saved-jobs", a.cookie, "POST", {
        jobId: "legacy-job-1",
      }),
    );
  expect(one.id).toBe(two.id);
  await env.DB.prepare("UPDATE saved_jobs SET legacy_id=? WHERE id=?")
    .bind("legacy-save", one.id)
    .run();
  expect(
    await (await request("/api/saved-jobs/legacy-save", a.cookie)).json(),
  ).toMatchObject({ id: one.id });
  expect(
    await env.DB.prepare(
      "SELECT count(*) FROM audit_events WHERE action='create' AND entity_type='saved_job'",
    ).first("count(*)"),
  ).toBe(1);
  expect(
    (
      await request(`/api/saved-jobs/${one.id}`, a.cookie, "PATCH", {
        expectedRevision: 1,
        status: "Offer",
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await request(`/api/saved-jobs/${one.id}`, a.cookie, "PATCH", {
        expectedRevision: 1,
        status: "Submitted",
        submissionUrl: "javascript:alert(1)",
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await request(`/api/saved-jobs/${one.id}`, a.cookie, "PATCH", {
        expectedRevision: 1,
        status: "Submitted",
        notes: "sensitive",
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await request(`/api/saved-jobs/${one.id}`, a.cookie, "PATCH", {
        expectedRevision: 1,
        notes: "stale",
      })
    ).status,
  ).toBe(409);
  expect(
    JSON.stringify(
      (await env.DB.prepare("SELECT * FROM audit_events").all()).results,
    ),
  ).not.toContain("sensitive");
  expect(
    await (await request("/api/dashboard", a.cookie)).json(),
  ).toMatchObject({ counts: { savedJobs: 1 } });
});
test("D1 batch rolls back all writes on a foreign key failure, with cross-owner composite constraints", async () => {
  const a = await account("alice"),
    b = await account("bob");
  const ua = await json<{ user: { id: string } }>(
      await request("/api/session", a.cookie),
    ),
    ub = await json<{ user: { id: string } }>(
      await request("/api/session", b.cookie),
    );
  const p = await json<{ id: string }>(
    await request("/api/profiles", a.cookie, "POST", {
      name: "A",
      content: {},
    }),
  );
  await expect(
    env.DB.batch([
      env.DB.prepare(
        "INSERT INTO users(id,created_at,updated_at) VALUES('rollback','x','x')",
      ),
      env.DB.prepare(
        "INSERT INTO active_profiles(user_id,profile_id) VALUES(?,?)",
      ).bind(ub.user.id, p.id),
    ]),
  ).rejects.toThrow();
  expect(
    await env.DB.prepare("SELECT id FROM users WHERE id='rollback'").first(),
  ).toBeNull();
  await seedJob();
  const s = await json<{ id: string }>(
    await request("/api/saved-jobs", a.cookie, "POST", { jobId: "job-1" }),
  );
  await expect(
    env.DB.prepare(
      "INSERT INTO draft_applications(id,user_id,saved_job_id,created_at,updated_at) VALUES('bad',?,?, 'x','x')",
    )
      .bind(ub.user.id, s.id)
      .run(),
  ).rejects.toThrow();
  await expect(
    env.DB.prepare(
      "INSERT INTO attachments(id,user_id,profile_id,status,scan_status,created_at) VALUES('bad',?,?,'missing','unknown','x')",
    )
      .bind(ub.user.id, p.id)
      .run(),
  ).rejects.toThrow();
  await expect(
    env.DB.prepare("UPDATE auth_identities SET user_id=? WHERE user_id=?")
      .bind(ub.user.id, ua.user.id)
      .run(),
  ).rejects.toThrow("immutable_identity");
});
test("job cursors have stable ordering, bounded filters, legacy resolution and safe source URLs", async () => {
  const a = await account("alice");
  await seedJob("a", "javascript:alert(1)");
  await seedJob("b");
  const first = await json<{ items: { id: string }[]; nextCursor: string }>(
    await request("/api/jobs?limit=1", a.cookie),
  );
  expect(first.items).toHaveLength(1);
  const second = await json<{ items: { id: string }[] }>(
    await request(
      `/api/jobs?limit=1&cursor=${encodeURIComponent(first.nextCursor)}`,
      a.cookie,
    ),
  );
  expect(second.items).toHaveLength(1);
  expect(second.items[0].id).not.toBe(first.items[0].id);
  expect(
    await (await request("/api/jobs/legacy-a", a.cookie)).json(),
  ).toMatchObject({ id: "a", sourceUrl: null });
  expect((await request("/api/jobs?limit=101", a.cookie)).status).toBe(400);
  expect((await request("/api/jobs?cursor=garbage", a.cookie)).status).toBe(
    400,
  );
  expect(
    await (await request("/api/jobs?q=missing", a.cookie)).json(),
  ).toMatchObject({ items: [] });
});
