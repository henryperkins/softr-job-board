import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { outsideRepository } from "../migration/private-files.ts";
import { openShadowStore } from "./local-store.ts";
import { acquireRun, inspectRun } from "../../workers/jobs/src/dispatcher.ts";
import { capturePage } from "../../workers/jobs/src/ingestion.ts";
import { sha256, type Source } from "../../workers/jobs/src/providers.ts";
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const input = arg("--snapshots"),
  destination = arg("--local-store"),
  date = arg("--date"),
  capturedAt = arg("--captured-at");
if (!input || !destination || !date || !capturedAt)
  throw new Error(
    "Usage: node scripts/ingestion/shadow.ts --snapshots <protected-directory> --local-store <new-protected-directory> --date YYYY-MM-DD --captured-at ISO --create (omit --create to replay a recognized store)",
  );
if (!Number.isFinite(Date.parse(capturedAt)))
  throw new Error("Invalid capture time");
const runtime = await openShadowStore(
  destination,
  process.argv.includes("--create"),
);
try {
  const sourceDirectory = await outsideRepository(input),
    reports = [];
  for (const board of ["anthropic", "stripe", "figma"] as const) {
    const file = await outsideRepository(
      path.join(sourceDirectory, `${board}.json`),
    );
    if ((await stat(file)).size > 16 * 1024 * 1024)
      throw new Error("Snapshot exceeds byte limit");
    const raw = new Uint8Array(await readFile(file)),
      source: Source = `greenhouse:${board}`,
      run = await acquireRun(runtime.env.DB, source, date);
    const before = await runtime.env.DB.prepare(
      "SELECT count(*) n FROM job_versions",
    ).first<number>("n");
    if (run.page_count === 0)
      await capturePage(runtime.env, run, raw, capturedAt);
    else {
      const checksum = await runtime.env.DB.prepare(
        "SELECT checksum FROM ingestion_pages WHERE run_id=? AND page=0",
      )
        .bind(run.id)
        .first<string>("checksum");
      if (checksum !== (await sha256(raw)))
        throw new Error("Date already captures different source bytes");
    }
    let completed = false;
    for (let i = 0; i < 10000; i++)
      if ((await runtime.advance(run.id)).done) {
        completed = true;
        break;
      }
    if (!completed) throw new Error("Shadow step bound exhausted");
    const report = await inspectRun(runtime.env.DB, run.id),
      after = await runtime.env.DB.prepare(
        "SELECT count(*) n FROM job_versions",
      ).first<number>("n");
    reports.push({
      ...report,
      newVersionsThisInvocation: (after ?? 0) - (before ?? 0),
      sourceHash: await sha256(raw),
    });
  }
  const report = {
    environment: "local-only",
    harnessHash: runtime.harnessHash,
    capturedAt,
    replayedAt: new Date().toISOString(),
    sources: reports,
    normalizationDifferences: [
      "board-scoped identity",
      "full descriptions and raw source fields",
      "salary currency and period retained; no annualization",
      "unknowns stay unknown; inference provenance explicit",
      "no title/company dedupe or 40-record truncation",
      "source-owned content versions; exact URL reuse only",
    ],
    providerAcceptance: {
      greenhouse: "captured public snapshot replay only",
      fantastic:
        "fixture coverage only; credentials, quota and live pagination pending",
      jobven:
        "fixture coverage only; credentials, quota and live pagination pending",
    },
    releaseReady: false,
  };
  await writeFile(
    path.join(runtime.directory, `shadow-report-${Date.now()}.json`),
    JSON.stringify(report, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  console.log(JSON.stringify(report));
  if (reports.some((r) => r.state !== "succeeded")) process.exitCode = 1;
} finally {
  await runtime.dispose();
}
