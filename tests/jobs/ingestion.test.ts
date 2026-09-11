import { beforeEach, expect, test, vi } from "vitest";
import {
  env,
  applyD1Migrations,
  reset,
  SELF,
  introspectWorkflowInstance,
} from "cloudflare:test";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import legacyCases from "../../fixtures/ingestion/legacy-normalization.json";
import { htmlToPlainText } from "../../workers/jobs/src/html-text";
import {
  advanceIngestion,
  capturePage,
  getRun,
} from "../../workers/jobs/src/ingestion";
import {
  acquireRun,
  chicagoClock,
  drainOutbox,
  dispatchSchedule,
  inspectRun,
  retryRun,
  recoverRestart,
  retryDispatch,
} from "../../workers/jobs/src/dispatcher";
import {
  canonicalJobUrl,
  fetchPage,
  normalize,
  parsePage,
  providerRequest,
  sourceSchema,
  type Source,
} from "../../workers/jobs/src/providers";
declare global {
  namespace Cloudflare {
    interface Env {
      MIGRATIONS: D1Migration[];
    }
  }
}
beforeEach(async () => {
  await reset();
  await applyD1Migrations(env.DB, env.MIGRATIONS);
});
const bytes = (data: unknown) => new TextEncoder().encode(JSON.stringify(data));
const gh = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  title: "Engineer",
  absolute_url: `https://boards.greenhouse.io/test/jobs/${id}`,
  content: "Full description",
  location: { name: "Chicago" },
  ...extra,
});
const snapshot = (rows: unknown[]) => ({
  jobs: rows,
  meta: { total: rows.length },
});
async function run(source: Source, rows: unknown[], date = "2026-09-11") {
  const r = await acquireRun(env.DB, source, date);
  if (r.state === "queued")
    await capturePage(
      env,
      r,
      bytes(
        source.startsWith("greenhouse:")
          ? snapshot(rows)
          : source.startsWith("fantastic:")
            ? rows
            : {
                data: rows,
                meta: { count: rows.length, hasMore: false, nextCursor: null },
              },
      ),
    );
  await drain(r.id);
  return getRun(env.DB, r.id);
}
async function drain(id: string, max = 1000) {
  for (let i = 0; i < max; i++)
    if (
      (
        await advanceIngestion(env, id, () => {
          throw new Error("unexpected network");
        })
      ).done
    )
      return;
  throw new Error("undrained");
}
const n = async (table: string) =>
  env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first<number>("n");
test("durable backlog exceeds 40, interrupted replay and unchanged next date add no versions", async () => {
  const r = await acquireRun(env.DB, "greenhouse:stripe", "2026-09-11");
  await capturePage(
    env,
    r,
    bytes(snapshot(Array.from({ length: 75 }, (_, i) => gh(i)))),
  );
  await advanceIngestion(env, r.id);
  expect(await n("ingestion_backlog")).toBe(25);
  await drain(r.id);
  expect(await n("jobs")).toBe(75);
  expect(await n("job_versions")).toBe(75);
  await drain(r.id);
  await run(
    "greenhouse:stripe",
    Array.from({ length: 75 }, (_, i) => gh(i)),
    "2026-09-12",
  );
  expect(await n("job_versions")).toBe(75);
  expect(await n("audit_events")).toBe(75);
  expect(
    await env.DB.prepare(
      "SELECT unchanged_count FROM ingestion_runs WHERE chicago_date='2026-09-12'",
    ).first("unchanged_count"),
  ).toBe(75);
});
test("content-only refresh preserves saved relations, immutable versions, legacy aliases and stable owner", async () => {
  await env.DB.prepare(
    "INSERT INTO users(id,created_at,updated_at) VALUES('u','t','t')",
  ).run();
  await env.DB.prepare(
    "INSERT INTO jobs(id,title,source_url,created_at,updated_at,legacy_id) VALUES('legacy','Engineer','https://boards.greenhouse.io/test/jobs/1','t','t','old-record')",
  ).run();
  await env.DB.prepare(
    "INSERT INTO job_versions(id,job_id,revision,content_json,created_at) VALUES('old','legacy',1,'{\"core\":{\"title\":\"Engineer\"}}','t')",
  ).run();
  await env.DB.prepare(
    "INSERT INTO job_sources(id,job_id,source_system,source_key,source_url) VALUES('alias','legacy','softr-legacy','table:record','https://boards.greenhouse.io/test/jobs/1')",
  ).run();
  await env.DB.prepare(
    "INSERT INTO saved_jobs(id,user_id,job_id,notes,created_at,updated_at) VALUES('save','u','legacy','keep notes','t','t')",
  ).run();
  await run("greenhouse:stripe", [gh(1)]);
  await run(
    "greenhouse:stripe",
    [
      gh(1, {
        content: "new description",
        metadata: [{ name: "new", value: "preserved" }],
      }),
    ],
    "2026-09-12",
  );
  await run("fantastic:active-ats", [
    {
      id: 5,
      title: "Aggregator title",
      url: gh(1).absolute_url,
      organization: "X",
      description_text: "Alternate source",
    },
  ]);
  expect(await n("jobs")).toBe(1);
  expect(await n("job_sources")).toBe(3);
  expect(
    await env.DB.prepare("SELECT description FROM jobs").first("description"),
  ).toBe("new description");
  expect(
    await env.DB.prepare("SELECT notes FROM saved_jobs").first("notes"),
  ).toBe("keep notes");
  expect(
    await env.DB.prepare("SELECT legacy_id FROM jobs").first("legacy_id"),
  ).toBe("old-record");
  await expect(
    env.DB.prepare("UPDATE job_versions SET content_json='{}'").run(),
  ).rejects.toThrow("immutable_version");
});
test("board identity, generic/ambiguous URLs and same titles do not merge", async () => {
  await run("greenhouse:stripe", [
    gh(1, { absolute_url: "https://example.test/careers" }),
    gh(2, {
      absolute_url: "https://example.test/careers",
      location: { name: "Paris" },
    }),
  ]);
  await run("greenhouse:figma", [
    gh(1, { absolute_url: "https://figma.example/jobs/1" }),
  ]);
  expect(await n("jobs")).toBe(3);
  expect(canonicalJobUrl("https://x.test/careers?gh_jid=42")).toBe(
    "https://x.test/careers?gh_jid=42",
  );
  expect(canonicalJobUrl("https://x.test/careers")).toBeNull();
});
test("safe closure is exact-board only; empty and implausible removals fail closed", async () => {
  const rows = Array.from({ length: 20 }, (_, i) => gh(i));
  await run("greenhouse:stripe", rows);
  await run("greenhouse:figma", [gh(90)]);
  const safe = await run("greenhouse:stripe", rows.slice(1), "2026-09-12");
  expect(safe.state).toBe("succeeded");
  expect(
    await env.DB.prepare(
      "SELECT count(*) n FROM jobs WHERE status='Closed'",
    ).first("n"),
  ).toBe(1);
  const empty = await run("greenhouse:stripe", [], "2026-09-13");
  expect(empty.state).toBe("review");
  const mass = await run("greenhouse:stripe", rows.slice(10), "2026-09-14");
  expect(mass.state).toBe("review");
  expect(
    await env.DB.prepare(
      "SELECT count(*) n FROM jobs WHERE status='Closed'",
    ).first("n"),
  ).toBe(1);
});
test("rolling absence never closes and rejected/duplicate records never import or close", async () => {
  await run("fantastic:active-ats", [
    {
      id: 1,
      title: "Engineer",
      url: "https://x.test/jobs/1",
      description_text: "full",
    },
  ]);
  await run("fantastic:active-ats", [], "2026-09-12");
  expect(await env.DB.prepare("SELECT status FROM jobs").first("status")).toBe(
    "Open",
  );
  const r = await acquireRun(env.DB, "greenhouse:stripe", "2026-09-11");
  await capturePage(
    env,
    r,
    bytes(snapshot([gh(1), gh(1), { id: 4, title: "bad" }])),
  );
  await expect(drain(r.id)).rejects.toThrow("rejected_records");
  expect((await getRun(env.DB, r.id)).snapshot_complete).toBe(0);
  expect(await n("jobs")).toBe(1);
});
test("actual Jobven plain description, all locations and salary unknowns are retained", () => {
  const job = normalize("jobven:public-jobs", {
    id: "j",
    title: "Engineer",
    descriptionPlain: "x".repeat(7000),
    status: "active",
    companies: [{ name: "company.com" }, { name: "other" }],
    locations: [{ addressLocality: "Paris" }, { addressLocality: "Chicago" }],
    salary: { min: 45, currency: "EUR", period: "hour" },
    applyUrl: null,
  });
  expect(job.core.description.length).toBe(7000);
  expect(job.salary).toMatchObject({
    min: 45,
    max: null,
    currency: "EUR",
    period: "hour",
  });
  expect(job.core.seniority).toBeNull();
  expect(job.companies).toHaveLength(2);
  expect(job.core.company).toBe("company.com");
  const unknown = normalize("jobven:public-jobs", {
    id: "u",
    title: "Engineer",
    descriptionPlain: "x",
    status: "active",
    companies: [],
    salary: { min: 12 },
  });
  expect(unknown.salary).toMatchObject({
    min: 12,
    currency: null,
    period: null,
  });
});
test("pagination validates missing/repeated/contradictory cursors; Fantastic offset traverses beyond 2 pages", async () => {
  const s = "jobven:public-jobs" as const;
  for (const meta of [
    { count: 1, hasMore: true, nextCursor: null },
    { count: 1, hasMore: true, nextCursor: "a" },
    { count: 1, hasMore: false, nextCursor: "b" },
  ])
    expect(() => parsePage(s, { data: [{}], meta }, "a")).toThrow(
      "invalid_pagination",
    );
  expect(
    parsePage(
      s,
      { data: [{}], meta: { count: 1, hasMore: false, nextCursor: null } },
      "a",
    ).complete,
  ).toBe(true);
  expect(
    providerRequest("fantastic:active-ats", "100", {
      FANTASTIC_AUTHORIZATION: "synthetic",
    }).url.searchParams.get("offset"),
  ).toBe("100");
  const r = await acquireRun(env.DB, s, "2026-09-11");
  let calls = 0;
  const fetcher: typeof fetch = () => {
    calls++;
    return Promise.resolve(
      new Response(
        JSON.stringify({
          data: [
            {
              id: String(calls),
              title: "Engineer",
              descriptionPlain: "full",
              companies: [],
              status: "active",
            },
          ],
          meta: {
            count: 1,
            hasMore: calls < 4,
            nextCursor: calls < 4 ? String(calls) : null,
          },
        }),
      ),
    );
  };
  const e = { ...env, JOBVEN_API_KEY: "synthetic" };
  for (let i = 0; i < 100; i++)
    if ((await advanceIngestion(e, r.id, fetcher)).done) break;
  expect(calls).toBe(4);
  expect(await n("jobs")).toBe(4);
});
test("page bound preserves cursor and durable backlog as incomplete", async () => {
  const r = await acquireRun(env.DB, "fantastic:active-ats", "2026-09-11");
  await capturePage(
    env,
    r,
    bytes(
      Array.from({ length: 50 }, (_, i) => ({
        id: i,
        title: "E",
        url: `https://x.test/jobs/${i}`,
        description_text: "full",
      })),
    ),
  );
  await advanceIngestion(env, r.id);
  await advanceIngestion(env, r.id);
  await expect(advanceIngestion(env, r.id, undefined, 1)).rejects.toThrow(
    "page_limit",
  );
  expect((await getRun(env.DB, r.id)).cursor).toBe("50");
  expect(await n("ingestion_backlog")).toBe(50);
  expect(await n("jobs")).toBe(0);
});
test("429, 500, timeout, malformed body and missing credentials isolate source runs and redact errors", async () => {
  for (const status of [429, 500])
    await expect(
      fetchPage("greenhouse:stripe", null, {}, () =>
        Promise.resolve(new Response("SECRET", { status })),
      ),
    ).rejects.toThrow(`http_${status}`);
  await expect(
    fetchPage(
      "greenhouse:stripe",
      null,
      {},
      (_url, init) =>
        new Promise((_, reject) =>
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("SECRET")),
          ),
        ),
      { timeoutMs: 5, maxBytes: 100 },
    ),
  ).rejects.toThrow("fetch_timeout");
  const r = await acquireRun(env.DB, "greenhouse:stripe", "2026-09-11");
  await expect(
    advanceIngestion(env, r.id, () =>
      Promise.resolve(new Response("SECRET malformed")),
    ),
  ).rejects.toThrow("malformed_json");
  await run("greenhouse:figma", [gh(1)]);
  expect((await getRun(env.DB, r.id)).state).toBe("failed");
  expect(JSON.stringify(await inspectRun(env.DB, r.id))).not.toContain(
    "SECRET",
  );
  await expect(fetchPage("jobven:public-jobs", null, {})).rejects.toThrow(
    "missing_credentials",
  );
});
test("Chicago 07:00 dispatcher handles both DST transitions and default flags", async () => {
  for (const [utc, date, eligible] of [
    ["2026-03-08T11:59:00Z", "2026-03-08", false],
    ["2026-03-08T12:00:00Z", "2026-03-08", true],
    ["2026-11-01T12:59:00Z", "2026-11-01", false],
    ["2026-11-01T13:00:00Z", "2026-11-01", true],
    ["2026-11-02T06:00:00Z", "2026-11-02", false],
  ] as const)
    expect(chicagoClock(new Date(utc))).toEqual({ date, eligible });
  await dispatchSchedule(
    { ...env, INGESTION_SCHEDULE_ENABLED: "false" },
    new Date("2026-09-11T13:00:00Z"),
  );
  expect(await n("ingestion_runs")).toBe(0);
  expect((await SELF.fetch("https://jobs.test/admin/retry")).status).toBe(404);
});
test("date uniqueness and ambiguous Workflow create reuse the exact ID", async () => {
  const a = await acquireRun(env.DB, "greenhouse:stripe", "2026-09-11"),
    b = await acquireRun(env.DB, "greenhouse:stripe", "2026-09-11");
  expect(a.id).toBe(b.id);
  expect(await n("outbox")).toBe(1);
  const create = vi.fn(() => Promise.reject(new Error("SECRET response lost"))),
    get = vi.fn(() =>
      Promise.resolve({
        status: () => Promise.resolve({ status: "running" as const }),
        restart: () => Promise.resolve(),
      }),
    );
  // Structural fake only covers the remote handoff ambiguity; D1 is the native runtime.
  await drainOutbox(env.DB, { create, get });
  expect(create.mock.calls).toHaveLength(1);
  expect(get).toHaveBeenCalledWith(a.workflow_id);
  expect(await env.DB.prepare("SELECT state FROM outbox").first("state")).toBe(
    "delivered",
  );
  await drainOutbox(env.DB, { create, get });
  expect(create.mock.calls).toHaveLength(1);
});
test("real Workflow drains captured data without returning raw payload", async () => {
  const r = await acquireRun(env.DB, "greenhouse:stripe", "2026-09-11");
  await capturePage(env, r, bytes(snapshot([gh(1)])));
  await using instance = await introspectWorkflowInstance(
    env.INGEST_SOURCE,
    r.workflow_id,
  );
  await env.INGEST_SOURCE.create({
    id: r.workflow_id,
    params: { runId: r.id },
  });
  await instance.waitForStatus("complete");
  expect(await instance.getOutput()).toEqual({
    done: true,
    state: "succeeded",
  });
  expect(await n("jobs")).toBe(1);
});

test("reviewed legacy fixtures preserve deliberate normalization differences", () => {
  for (const item of legacyCases.cases)
    expect(
      normalize(sourceSchema.parse(item.source), item.input),
    ).toMatchObject(item.expected);
  const inferred = normalize(
    "greenhouse:stripe",
    gh(1, { title: "Senior Engineer", location: { name: "Remote" } }),
  );
  expect(inferred.core).toMatchObject({
    remote: "Remote",
    seniority: "Senior",
    employment: null,
  });
  expect(inferred.provenance.inferred).toMatchObject({
    remote: "location-text-heuristic",
    seniority: "title-heuristic",
    tags: "title-heuristic",
  });
});

test("a write failure rolls back job, version, audit, count and backlog together", async () => {
  const r = await acquireRun(env.DB, "greenhouse:stripe", "2026-09-11");
  await capturePage(env, r, bytes(snapshot([gh(1)])));
  await advanceIngestion(env, r.id);
  await advanceIngestion(env, r.id);
  await env.DB.prepare(
    "CREATE TRIGGER synthetic_failure BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT,'synthetic'); END",
  ).run();
  await expect(advanceIngestion(env, r.id)).rejects.toThrow();
  expect(await n("jobs")).toBe(0);
  expect(await n("job_versions")).toBe(0);
  expect(
    await env.DB.prepare("SELECT state FROM ingestion_backlog").first("state"),
  ).toBe("pending");
  expect(
    await env.DB.prepare("SELECT created_count FROM ingestion_runs").first(
      "created_count",
    ),
  ).toBe(0);
  await env.DB.prepare("DROP TRIGGER synthetic_failure").run();
  const restart = vi.fn(() =>
      Promise.reject(new Error("SECRET ambiguous restart")),
    ),
    workflow = {
      create: () => Promise.resolve(),
      get: () =>
        Promise.resolve({
          status: () => Promise.resolve({ status: "errored" as const }),
          restart,
        }),
    };
  await expect(retryRun(env, workflow, r.id, 0)).rejects.toThrow(
    "restart_unconfirmed",
  );
  expect(await n("audit_events")).toBe(1);
  const recover = {
    ...workflow,
    get: () =>
      Promise.resolve({
        status: () => Promise.resolve({ status: "running" as const }),
        restart,
      }),
  };
  await recoverRestart(env, recover, r.id, 1);
  expect(restart).toHaveBeenCalledTimes(1);
  await drain(r.id);
  expect(await n("jobs")).toBe(1);
  expect(await n("job_versions")).toBe(1);
  expect(await n("audit_events")).toBe(2);
  await expect(retryRun(env, recover, r.id, 1)).rejects.toThrow(
    "retry_state_conflict",
  );
});

test("failed source dispatch does not block peers and bounded outbox attempts require audited reopening", async () => {
  const created: string[] = [];
  const workflow = {
    create: ({ id }: { id: string }) => {
      created.push(id);
      return id.includes("fantastic")
        ? Promise.reject(new Error("SECRET"))
        : Promise.resolve();
    },
    get: () => Promise.reject(new Error("SECRET")),
  };
  const now = new Date("2026-09-11T13:00:00Z");
  await dispatchSchedule(
    { ...env, INGEST_SOURCE: workflow, INGESTION_SCHEDULE_ENABLED: "true" },
    now,
  );
  expect(await n("ingestion_runs")).toBe(5);
  expect(
    await env.DB.prepare(
      "SELECT count(*) n FROM outbox WHERE state='delivered'",
    ).first("n"),
  ).toBe(4);
  for (let i = 1; i < 6; i++)
    await drainOutbox(env.DB, workflow, new Date(now.getTime() + i * 3600000));
  const r = await getRun(env.DB, "ingest-fantastic-active-ats-2026-09-11");
  expect(created.filter((id) => id === r.id)).toHaveLength(5);
  expect(JSON.stringify(await inspectRun(env.DB, r.id))).not.toContain(
    "SECRET",
  );
  await retryDispatch(env, r.id, 0);
  expect((await getRun(env.DB, r.id)).retry_revision).toBe(1);
  expect(await n("audit_events")).toBe(1);
  await expect(retryDispatch(env, r.id, 0)).rejects.toThrow(
    "dispatch_retry_conflict",
  );
});

test("nonadjacent repeated cursor and Greenhouse count mismatch retain incomplete evidence", async () => {
  const r = await acquireRun(env.DB, "jobven:public-jobs", "2026-09-11");
  for (const [next, id] of [
    ["a", 1],
    ["b", 2],
  ] as const)
    await capturePage(
      env,
      await getRun(env.DB, r.id),
      bytes({
        data: [{ id }],
        meta: { count: 1, hasMore: true, nextCursor: next },
      }),
    );
  await expect(
    capturePage(
      env,
      await getRun(env.DB, r.id),
      bytes({
        data: [{ id: 3 }],
        meta: { count: 1, hasMore: true, nextCursor: "a" },
      }),
    ),
  ).rejects.toThrow("repeated_cursor");
  expect((await getRun(env.DB, r.id)).page_count).toBe(2);
  const ghRun = await acquireRun(env.DB, "greenhouse:figma", "2026-09-11");
  await expect(
    capturePage(env, ghRun, bytes({ jobs: [gh(1)], meta: { total: 2 } })),
  ).rejects.toThrow("invalid_snapshot_count");
  expect(await n("ingestion_reviews")).toBe(1);
});

test("fetch retry and byte bounds are enforced without logging response data", async () => {
  const fetcher = vi.fn(() =>
    Promise.resolve(new Response("SECRET", { status: 503 })),
  );
  await expect(
    fetchPage("greenhouse:stripe", null, {}, fetcher, {
      timeoutMs: 100,
      maxBytes: 10,
      retryDelayMs: 0,
    }),
  ).rejects.toThrow("http_503");
  expect(fetcher).toHaveBeenCalledTimes(3);
  await expect(
    fetchPage(
      "greenhouse:stripe",
      null,
      {},
      () => Promise.resolve(new Response("x".repeat(11))),
      { timeoutMs: 100, maxBytes: 10 },
    ),
  ).rejects.toThrow("response_bytes_limit");
  await expect(
    advanceIngestion({ ...env, INGESTION_WRITES_ENABLED: "false" }, "missing"),
  ).rejects.toThrow("writes_disabled");
});

test("Fantastic 151 records traverse all offset pages, then rolling absence stays open", async () => {
  const r = await acquireRun(env.DB, "fantastic:active-ats", "2026-09-11"),
    offsets: string[] = [];
  const all = Array.from({ length: 151 }, (_, id) => ({
    id,
    title: "Engineer",
    url: `https://x.test/jobs/${id}`,
    description_text: "full",
  }));
  const fetcher: typeof fetch = (input) => {
    const url = new URL(String(input));
    offsets.push(url.searchParams.get("offset")!);
    const offset = Number(url.searchParams.get("offset"));
    return Promise.resolve(
      new Response(JSON.stringify(all.slice(offset, offset + 50))),
    );
  };
  for (let i = 0; i < 100; i++)
    if (
      (
        await advanceIngestion(
          { ...env, FANTASTIC_AUTHORIZATION: "synthetic" },
          r.id,
          fetcher,
        )
      ).done
    )
      break;
  expect(offsets).toEqual(["0", "50", "100", "150"]);
  expect(await n("jobs")).toBe(151);
  expect((await getRun(env.DB, r.id)).state).toBe("succeeded");
});

test("a paused older snapshot cannot reopen a job closed by a newer successful board snapshot", async () => {
  const rows = Array.from({ length: 20 }, (_, i) => gh(i));
  async function captured(date: string, data: unknown[]) {
    const r = await acquireRun(env.DB, "greenhouse:stripe", date);
    await capturePage(env, r, bytes(snapshot(data)), `${date}T12:00:00Z`);
    return r;
  }
  const baseline = await captured("2026-09-11", rows);
  await drain(baseline.id);
  const paused = await captured("2026-09-12", rows);
  await advanceIngestion(env, paused.id);
  await advanceIngestion(env, paused.id);
  const newer = await captured("2026-09-13", rows.slice(1));
  await drain(newer.id);
  const before = await n("job_versions");
  expect(
    await env.DB.prepare("SELECT status FROM jobs WHERE source_url=?")
      .bind(gh(0).absolute_url)
      .first("status"),
  ).toBe("Closed");
  await expect(advanceIngestion(env, paused.id)).rejects.toThrow();
  expect(
    await env.DB.prepare("SELECT status FROM jobs WHERE source_url=?")
      .bind(gh(0).absolute_url)
      .first("status"),
  ).toBe("Closed");
  expect(await n("job_versions")).toBe(before);
});

test("a crash claiming attempt five becomes explicitly recoverable after its lease expires", async () => {
  const r = await acquireRun(env.DB, "greenhouse:stripe", "2026-09-11");
  await env.DB.prepare(
    "UPDATE outbox SET state='dispatching',attempts=5,lease_until='2026-09-11T12:00:00Z' WHERE id=?",
  )
    .bind(r.id)
    .run();
  const create = vi.fn(() => Promise.resolve()),
    get = vi.fn(() => Promise.reject(new Error("must not need remote state")));
  await drainOutbox(env.DB, { create, get }, new Date("2026-09-11T13:00:00Z"));
  expect(create).not.toHaveBeenCalled();
  expect(await env.DB.prepare("SELECT state FROM outbox").first("state")).toBe(
    "failed",
  );
  await retryDispatch(env, r.id, 0);
  expect(await env.DB.prepare("SELECT state FROM outbox").first("state")).toBe(
    "pending",
  );
  expect((await getRun(env.DB, r.id)).retry_revision).toBe(1);
});

test("Greenhouse HTML becomes readable text while exact source HTML stays immutable", () => {
  const html =
    "<h2>About &amp; role</h2><p>First&nbsp;paragraph.<br>Next line.</p><ul><li>One &lt; two</li><li>Two</li></ul><script>steal()</script><style>.hidden{}</style><p>Last &#169; text.</p>";
  const plain = htmlToPlainText(html);
  expect(plain).toContain("About & role\n");
  expect(plain).toContain("First paragraph.\nNext line.");
  expect(plain).toContain("• One < two\n");
  expect(plain).toContain("Last © text.");
  expect(plain).not.toContain("steal");
  expect(plain).not.toContain(".hidden");
  expect(plain).not.toContain("<p>");
  const encoded = html
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  expect(htmlToPlainText(encoded)).toBe(plain);
  const job = normalize("greenhouse:stripe", gh(1, { content: encoded }));
  expect(job.core.description).toBe(plain);
  expect(job.sourceFields.content).toBe(encoded);
  expect(htmlToPlainText("<p>" + "x".repeat(7000) + "</p>").length).toBe(7000);
  expect(() => htmlToPlainText("x".repeat(200001))).toThrow(
    "description_bytes_limit",
  );
});

async function pauseBeforeFinish(
  date: string,
  rows: unknown[],
  capturedAt = `${date}T12:00:00Z`,
) {
  const r = await acquireRun(env.DB, "greenhouse:stripe", date);
  await capturePage(env, r, bytes(snapshot(rows)), capturedAt);
  for (let i = 0; i < 100; i++) {
    const current = await getRun(env.DB, r.id);
    const pending = await env.DB.prepare(
      "SELECT count(*) n FROM ingestion_backlog WHERE run_id=? AND state='pending'",
    )
      .bind(r.id)
      .first<number>("n");
    if (current.snapshot_complete && pending === 0) return current;
    await advanceIngestion(env, r.id);
  }
  throw new Error("did not pause before finish");
}

test("closure excludes a newer unchanged observation before its run has finished", async () => {
  const rows = Array.from({ length: 20 }, (_, i) => gh(i));
  const baseline = await pauseBeforeFinish("2026-09-01", rows);
  await drain(baseline.id);
  const older = await pauseBeforeFinish("2026-09-02", rows.slice(1));
  const newer = await pauseBeforeFinish("2026-09-03", [rows[0]]);
  expect(
    await env.DB.prepare(
      "SELECT unchanged_count FROM ingestion_runs WHERE id=?",
    )
      .bind(newer.id)
      .first("unchanged_count"),
  ).toBe(1);
  expect(newer.state).toBe("importing");
  await drain(older.id);
  expect(
    await env.DB.prepare("SELECT status FROM jobs WHERE source_url=?")
      .bind(gh(0).absolute_url)
      .first("status"),
  ).toBe("Open");
  expect(
    await env.DB.prepare("SELECT closed_count FROM ingestion_runs WHERE id=?")
      .bind(older.id)
      .first("closed_count"),
  ).toBe(0);
});

test("closure uses immutable membership when a same-capture replay changes the observation pointer", async () => {
  const rows = Array.from({ length: 20 }, (_, i) => gh(i));
  const older = await pauseBeforeFinish("2026-09-02", rows);
  await pauseBeforeFinish("2026-09-03", [rows[0]], "2026-09-02T12:00:00Z");
  await drain(older.id);
  expect(
    await env.DB.prepare("SELECT status FROM jobs WHERE source_url=?")
      .bind(gh(0).absolute_url)
      .first("status"),
  ).toBe("Open");
  expect(
    await env.DB.prepare("SELECT closed_count FROM ingestion_runs WHERE id=?")
      .bind(older.id)
      .first("closed_count"),
  ).toBe(0);
});

test("closure transaction rejects an unchanged newer observation arriving after candidate selection", async () => {
  const rows = Array.from({ length: 20 }, (_, i) => gh(i));
  const baseline = await pauseBeforeFinish("2026-09-01", rows);
  await drain(baseline.id);
  const older = await pauseBeforeFinish("2026-09-02", rows.slice(1));
  const newer = await acquireRun(env.DB, "greenhouse:stripe", "2026-09-03");
  await capturePage(
    env,
    newer,
    bytes(snapshot([rows[0]])),
    "2026-09-03T12:00:00Z",
  );
  await advanceIngestion(env, newer.id);
  await advanceIngestion(env, newer.id);
  const versions = await n("job_versions");
  let raced = false;
  const database = new Proxy(env.DB, {
    get(target, property) {
      if (property === "batch")
        return async <T>(statements: D1PreparedStatement[]) => {
          raced = true;
          await advanceIngestion(env, newer.id);
          return target.batch<T>(statements);
        };
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  await expect(
    advanceIngestion({ ...env, DB: database }, older.id),
  ).rejects.toThrow();
  expect(raced).toBe(true);
  expect(await n("job_versions")).toBe(versions);
  expect(
    await env.DB.prepare("SELECT status FROM jobs WHERE source_url=?")
      .bind(gh(0).absolute_url)
      .first("status"),
  ).toBe("Open");
  expect(
    await env.DB.prepare(
      "SELECT unchanged_count FROM ingestion_runs WHERE id=?",
    )
      .bind(newer.id)
      .first("unchanged_count"),
  ).toBe(1);
  expect((await getRun(env.DB, newer.id)).state).toBe("importing");
});

test("generic listing and category URLs never merge distinct external identities", async () => {
  const generic = [
    "https://synthetic.test/jobs/search",
    "https://synthetic.test/jobs/all",
    "https://synthetic.test/jobs/category/engineering",
    "https://synthetic.test/jobs/search/123",
  ];
  for (const url of generic) expect(canonicalJobUrl(url)).toBeNull();
  const rows = generic.flatMap((url, i) => [
    gh(i * 2, { absolute_url: url }),
    gh(i * 2 + 1, { absolute_url: url }),
  ]);
  await run("greenhouse:figma", rows);
  expect(await n("jobs")).toBe(8);
  expect(await n("job_sources")).toBe(8);
  expect(await n("ingestion_reviews")).toBe(8);
  for (const url of [
    "https://boards.greenhouse.io/synthetic/jobs/12345",
    "https://stripe.com/jobs/listing/software-engineer/67890",
    "https://jobs.lever.co/synthetic/12345678-abcd-1234-abcd-123456789abc",
    "https://synthetic.test/positions/REQ-42",
    "https://synthetic.test/careers?gh_jid=12345&gh_src=retain",
    "https://synthetic.test/careers?reqid=REQ-42&location=Chicago",
  ])
    expect(canonicalJobUrl(url)).toBe(url);
});
