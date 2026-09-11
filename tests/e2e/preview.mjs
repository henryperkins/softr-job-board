// Local fixture-only harness. All Wrangler commands have --local and a dedicated persistence path.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { hashPassword } from "better-auth/crypto";
import { accounts } from "./synthetic-accounts.mjs";
const root = resolve(import.meta.dirname, "../.."),
  state = resolve(root, ".wrangler", "e2e-" + Date.now().toString(36));
const cli = resolve(root, "node_modules/wrangler/bin/wrangler.js");
const config = resolve(root, "workers/app/wrangler.jsonc");
const port = Number(process.env.SYNTHETIC_PORT ?? 8787);
if (!Number.isSafeInteger(port) || port < 1024 || port > 64535)
  throw new Error("Invalid local synthetic port");
const env = { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "true" };
function run(args) {
  const r = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    stdio: "inherit",
    env,
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
mkdirSync(state, { recursive: true });
run([
  "d1",
  "migrations",
  "apply",
  "DB",
  "--config",
  config,
  "--local",
  "--persist-to",
  state,
]);
const quote = (v) =>
  v === null ? "NULL" : `'${String(v).replaceAll("'", "''")}'`;
const stamp = "2026-09-01T12:00:00.000Z",
  time = Date.parse(stamp),
  sql = [];
for (const a of accounts) {
  const hashed = await hashPassword(a.password);
  sql.push(
    `INSERT OR IGNORE INTO auth_user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(${[a.id, a.name, a.email, 1, time, time].map(quote)});`,
  );
  sql.push(
    `INSERT OR IGNORE INTO auth_account(id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES(${[a.id + "-credential", a.id, "credential", a.id, hashed, time, time].map(quote)});`,
  );
  sql.push(
    `INSERT OR IGNORE INTO users(id,name,email,created_at,updated_at) VALUES(${[a.owner, a.name, a.email, stamp, stamp].map(quote)});`,
  );
  sql.push(
    `INSERT OR IGNORE INTO auth_identities(issuer,subject,user_id,created_at) VALUES(${["email-password", a.id, a.owner, stamp].map(quote)});`,
  );
}
for (let i = 1; i <= 32; i++) {
  const id = `synthetic-job-${String(i).padStart(2, "0")}`;
  sql.push(
    `INSERT OR IGNORE INTO jobs(id,legacy_id,title,company,location,remote,employment,seniority,description,source_url,status,created_at,updated_at) VALUES(${[id, "legacy-" + id, i === 1 ? "Senior AI Engineer" : `AI Platform Engineer ${i}`, i % 2 ? "Example Research" : "Sample Systems", i % 2 ? "Chicago, IL" : null, i % 2 ? "Remote" : "Hybrid", i % 3 ? "Full-time" : "Contract", i % 2 ? "Senior" : "Mid-level", "Synthetic role for local browser acceptance. Build reliable AI tools. <script>This source text is inert.</script>", "https://example.test/jobs/" + i, "Open", stamp, stamp].map(quote)});`,
  );
}
// Give A a persisted profile and legacy draft; B starts empty to exercise onboarding.
sql.push(
  "INSERT OR IGNORE INTO job_versions(id,job_id,revision,content_json,created_at) SELECT id||'-v1',id,revision,json_object('title',title,'company',company,'description',description),created_at FROM jobs;",
);
sql.push(
  `INSERT OR IGNORE INTO candidate_profiles(id,user_id,name,content_json,created_at,updated_at) VALUES('synthetic-profile-a','synthetic-owner-a','Test Candidate A','{"headline":"AI platform engineer","summary":"Synthetic persisted profile","skills":["TypeScript","SQL"]}',${quote(stamp)},${quote(stamp)});`,
);
sql.push(
  `INSERT OR IGNORE INTO profile_versions(id,profile_id,user_id,revision,name,content_json,created_at) SELECT 'synthetic-profile-version-a',id,user_id,revision,name,content_json,created_at FROM candidate_profiles WHERE id='synthetic-profile-a';`,
);
sql.push(
  `INSERT OR IGNORE INTO active_profiles(user_id,profile_id,profile_version_id) VALUES('synthetic-owner-a','synthetic-profile-a','synthetic-profile-version-a');`,
);
sql.push(
  `INSERT OR IGNORE INTO saved_jobs(id,legacy_id,user_id,job_id,status,created_at,updated_at) VALUES('synthetic-save-a','legacy-synthetic-save-a','synthetic-owner-a','synthetic-job-01','Draft Ready',${quote(stamp)},${quote(stamp)});`,
);
sql.push(
  `INSERT OR IGNORE INTO draft_applications(id,user_id,saved_job_id,profile_id,profile_version_id,status,cover_letter,short_answers,created_at,updated_at) VALUES('synthetic-draft-a','synthetic-owner-a','synthetic-save-a','synthetic-profile-a','synthetic-profile-version-a','Ready for Review','Synthetic draft for human review.','Synthetic answer.',${quote(stamp)},${quote(stamp)});`,
);
sql.push(
  `INSERT OR IGNORE INTO draft_versions(id,draft_id,user_id,revision,cover_letter,short_answers,status,created_at) SELECT 'synthetic-draft-version-a',id,user_id,revision,cover_letter,short_answers,status,created_at FROM draft_applications WHERE id='synthetic-draft-a';`,
);
const file = resolve(state, "seed.sql");
writeFileSync(file, sql.join("\n"));
run([
  "d1",
  "execute",
  "DB",
  "--config",
  config,
  "--local",
  "--persist-to",
  state,
  "--file",
  file,
]);
console.log(
  `LOCAL synthetic preview: http://localhost:${port} — test identities in tests/e2e/synthetic-accounts.mjs`,
);
const child = spawn(
  process.execPath,
  [
    cli,
    "dev",
    "--config",
    config,
    "--local",
    "--persist-to",
    state,
    "--ip",
    "127.0.0.1",
    "--port",
    String(port),
    "--inspector-port",
    String(port + 1000),
    "--var",
    `APP_ORIGIN:http://localhost:${port}`,
    "--var",
    "WRITES_ENABLED:true",
    ...(process.env.SYNTHETIC_MCP === "true"
      ? ["--var", "MCP_ENABLED:true"]
      : []),
    ...(process.env.SYNTHETIC_MCP_WRITES === "true"
      ? ["--var", "MCP_WRITES_ENABLED:true"]
      : []),
    ...(process.env.SYNTHETIC_MCP_GENERATION === "true"
      ? ["--var", "MCP_GENERATION_ENABLED:true"]
      : []),
    ...(process.env.SYNTHETIC_MCP_REVIEW === "true"
      ? ["--var", "MCP_REVIEW_ENABLED:true"]
      : []),
    ...(process.env.SYNTHETIC_GENERATION === "true"
      ? ["--var", "GENERATION_ENABLED:true"]
      : []),
    "--var",
    "BETTER_AUTH_SECRET:synthetic-local-preview-secret-at-least-32-characters",
  ],
  { cwd: root, stdio: "inherit", env },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
