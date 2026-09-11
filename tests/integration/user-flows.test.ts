import { beforeEach, expect, test } from "vitest";
import { account, env, json, request, seedJob, setup, SELF } from "./helpers";
beforeEach(setup);
async function profile(cookie: string) {
  return json<{ id: string; revision: number }>(
    await request("/api/profiles", cookie, "POST", {
      name: "Synthetic profile",
      content: { summary: "Retained text" },
    }),
  );
}
async function upload(
  id: string,
  cookie: string,
  revision = 1,
  bytes = new TextEncoder().encode("%PDF-1.7\nsynthetic document"),
) {
  const form = new FormData();
  form.set("expectedRevision", String(revision));
  form.set(
    "file",
    new File([bytes], "resume.pdf", { type: "application/pdf" }),
  );
  return SELF.fetch(`https://app.test/api/profiles/${id}/attachments`, {
    method: "POST",
    headers: { Origin: "https://app.test", Cookie: cookie },
    body: form,
  });
}
test("archive and restore preserve versions, clear active choice and isolate owners", async () => {
  const a = await account("alice"),
    b = await account("bob"),
    p = await profile(a.cookie);
  await request(`/api/profiles/${p.id}/activate`, a.cookie, "POST", {});
  expect(
    (
      await request(`/api/profiles/${p.id}/archive`, b.cookie, "POST", {
        expectedRevision: 1,
        archived: true,
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await request(`/api/profiles/${p.id}/archive`, a.cookie, "POST", {
        expectedRevision: 1,
        archived: true,
      })
    ).status,
  ).toBe(200);
  expect(await (await request("/api/profiles", a.cookie)).json()).toMatchObject(
    { activeProfileId: null, items: [{ archived: true, revision: 2 }] },
  );
  expect(
    (await request(`/api/profiles/${p.id}/activate`, a.cookie, "POST", {}))
      .status,
  ).toBe(409);
  expect(
    (
      await request(`/api/profiles/${p.id}/archive`, a.cookie, "POST", {
        expectedRevision: 1,
        archived: false,
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await request(`/api/profiles/${p.id}/archive`, a.cookie, "POST", {
        expectedRevision: 2,
        archived: false,
      })
    ).status,
  ).toBe(200);
  expect(
    await env.DB.prepare(
      "SELECT count(*) AS n FROM profile_versions WHERE profile_id=?",
    )
      .bind(p.id)
      .first("n"),
  ).toBe(3);
});
test("upload creates private quarantined version, rejects unsafe bytes and isolates ownership", async () => {
  const a = await account("alice"),
    b = await account("bob"),
    p = await profile(a.cookie);
  expect((await upload(p.id, b.cookie)).status).toBe(404);
  expect(
    (
      await upload(
        p.id,
        a.cookie,
        1,
        new TextEncoder().encode("<script>bad</script>"),
      )
    ).status,
  ).toBe(400);
  const res = await upload(p.id, a.cookie);
  expect(res.status).toBe(201);
  const data = await json<{
    attachment: { id: string };
    profile: { revision: number; content: { attachmentIds: string[] } };
  }>(res);
  expect(data.profile).toMatchObject({
    revision: 2,
    content: { attachmentIds: [data.attachment.id] },
  });
  expect(
    (await request(`/api/attachments/${data.attachment.id}/download`, a.cookie))
      .status,
  ).toBe(409);
  expect(
    (await request(`/api/profiles/${p.id}/attachments`, b.cookie)).status,
  ).toBe(404);
  expect(
    await (await request(`/api/profiles/${p.id}/attachments`, a.cookie)).json(),
  ).toMatchObject({ items: [{ status: "pending", scanStatus: "pending" }] });
  expect((await upload(p.id, a.cookie, 1)).status).toBe(409);
  expect((await env.PRIVATE_FILES.list()).objects).toHaveLength(1);
});
test("failed upload DB transaction removes only its newly created object and preserves profile", async () => {
  const a = await account("alice"),
    p = await profile(a.cookie);
  await env.PRIVATE_FILES.put("existing-object", "keep");
  await env.DB.exec(
    "CREATE TRIGGER reject_upload_audit BEFORE INSERT ON audit_events WHEN NEW.action='upload' BEGIN SELECT RAISE(ABORT,'synthetic_failure'); END;",
  );
  expect((await upload(p.id, a.cookie)).status).toBe(500);
  expect(
    await (await request(`/api/profiles/${p.id}`, a.cookie)).json(),
  ).toMatchObject({ revision: 1, content: { summary: "Retained text" } });
  expect((await env.PRIVATE_FILES.list()).objects.map((o) => o.key)).toEqual([
    "existing-object",
  ]);
  expect(
    await env.DB.prepare("SELECT count(*) AS n FROM attachments").first("n"),
  ).toBe(0);
});
test("saved pagination has real job labels and continues beyond 500 with owner scoped history/activity", async () => {
  const a = await account("alice"),
    b = await account("bob");
  const actor = await json<{ user: { id: string } }>(
    await request("/api/session", a.cookie),
  );
  const t = "2026-01-01T00:00:00.000Z";
  for (let i = 0; i < 6; i++) {
    const batch = [];
    for (let n = i * 100; n < Math.min(505, (i + 1) * 100); n++) {
      const id = `job-${String(n).padStart(4, "0")}`;
      batch.push(
        env.DB.prepare(
          "INSERT INTO jobs(id,title,company,created_at,updated_at) VALUES(?,?,?,?,?)",
        ).bind(id, `Role ${n}`, "Synthetic Co", t, t),
      );
      batch.push(
        env.DB.prepare(
          "INSERT INTO saved_jobs(id,user_id,job_id,status,created_at,updated_at) VALUES(?,?,?,'Saved',?,?)",
        ).bind(`save-${n}`, actor.user.id, id, t, t),
      );
    }
    if (batch.length) await env.DB.batch(batch);
  }
  let cursor: string | null = null;
  const ids: string[] = [];
  do {
    const page: {
      items: { id: string; job: { title: string; company: string } }[];
      nextCursor: string | null;
    } = await json<{
      items: { id: string; job: { title: string; company: string } }[];
      nextCursor: string | null;
    }>(
      await request(
        "/api/saved-jobs?limit=100" +
          (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
        a.cookie,
      ),
    );
    expect(page.items[0].job.company).toBe("Synthetic Co");
    ids.push(...page.items.map((x) => x.id));
    cursor = page.nextCursor;
  } while (cursor);
  expect(ids).toHaveLength(505);
  expect(new Set(ids).size).toBe(505);
  expect(
    await (await request("/api/saved-jobs", b.cookie)).json(),
  ).toMatchObject({ items: [] });
  expect(
    (await request("/api/saved-jobs/save-0/drafts", b.cookie)).status,
  ).toBe(404);
  const p = await profile(a.cookie);
  expect(await (await request("/api/activity", a.cookie)).json()).toMatchObject(
    { items: [{ entityId: p.id, action: "create" }] },
  );
  expect(await (await request("/api/activity", b.cookie)).json()).toMatchObject(
    { items: [] },
  );
});
test("jobs expose available filters and unknown legacy browser records are HTTP 404", async () => {
  const a = await account("alice");
  await seedJob();
  await env.DB.prepare(
    "UPDATE jobs SET remote='Remote',employment='Full-time',seniority='Senior'",
  ).run();
  expect(await (await request("/api/job-options", a.cookie)).json()).toEqual({
    remote: ["Remote"],
    employment: ["Full-time"],
    seniority: ["Senior"],
  });
  expect(
    (await request("/job-details?recordId=missing", a.cookie)).status,
  ).toBe(404);
  expect((await request("/assets/missing.js")).status).toBe(404);
});
test("retried profile creation returns one persisted profile and never claims another owner", async () => {
  const a = await account("alice"),
    b = await account("bob");
  const body = {
    name: "Resumable onboarding",
    content: { summary: "Keep" },
    idempotencyKey: "synthetic-retry",
  };
  const one = await request("/api/profiles", a.cookie, "POST", body);
  expect(one.status).toBe(201);
  const p = await json<{ id: string }>(one);
  const two = await json<{ id: string }>(
    await request("/api/profiles", a.cookie, "POST", body),
  );
  expect(two.id).toBe(p.id);
  const other = await json<{ id: string }>(
    await request("/api/profiles", b.cookie, "POST", body),
  );
  expect(other.id).not.toBe(p.id);
  expect(
    await env.DB.prepare(
      "SELECT count(*) AS n FROM profile_versions WHERE profile_id=?",
    )
      .bind(p.id)
      .first("n"),
  ).toBe(1);
});
test("open jobs filter excludes closed roles and save state is owner scoped", async () => {
  const a = await account("alice"),
    b = await account("bob");
  await seedJob("open");
  await seedJob("closed");
  await env.DB.prepare(
    "UPDATE jobs SET status=CASE id WHEN 'open' THEN 'Open' ELSE 'Closed' END",
  ).run();
  expect(
    await (await request("/api/jobs?status=Open", a.cookie)).json(),
  ).toMatchObject({ items: [{ id: "open" }] });
  const saved = await json<{ id: string }>(
    await request("/api/saved-jobs", a.cookie, "POST", { jobId: "open" }),
  );
  expect(
    await (await request("/api/jobs/legacy-open/save-state", a.cookie)).json(),
  ).toEqual({ savedJobId: saved.id });
  expect(
    await (await request("/api/jobs/open/save-state", b.cookie)).json(),
  ).toEqual({ savedJobId: null });
});
