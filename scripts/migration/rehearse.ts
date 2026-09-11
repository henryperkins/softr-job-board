import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { outsideRepository } from "./private-files.ts";
import { openLocalMigration } from "./local-runtime.ts";
import { importRecords } from "./import-d1.ts";
import { copyToPrivateR2, reconcile } from "./reconcile.ts";
import type { SourceExport } from "./validate-export.ts";
import type { Manifest } from "./copy-attachments.ts";

const arg = (flag: string) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const input = arg("--manifest"),
  target = arg("--local-store");
if (!input || !target) {
  console.error(
    "Usage: node scripts/migration/rehearse.ts --manifest <protected-source-export.json> --local-store <protected-local-target>",
  );
  process.exitCode = 2;
} else {
  let runtime: Awaited<ReturnType<typeof openLocalMigration>> | undefined;
  try {
    const inputPath = await outsideRepository(input);
    const source = JSON.parse(
      await readFile(inputPath, "utf8"),
    ) as SourceExport;
    const archive = path.dirname(inputPath);
    const files = JSON.parse(
      await readFile(path.join(archive, "attachment-manifest.json"), "utf8"),
    ) as Manifest;
    runtime = await openLocalMigration(target);
    const imported = await importRecords(runtime.db, source, files);
    const copied =
      imported.state === "rehearsed"
        ? await copyToPrivateR2(runtime.files, source, files, archive)
        : null;
    const reconciled = await reconcile(
      runtime.db,
      runtime.files,
      source,
      files,
    );
    const report = {
      capturedAt: new Date().toISOString(),
      environment: "local-only",
      imported,
      copied,
      reconciled,
      releaseReady: false,
    };
    await writeFile(
      path.join(runtime.directory, "report-" + Date.now() + ".json"),
      JSON.stringify(report, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    const issueCounts: Record<string, number> = {};
    for (const issue of [...imported.issues, ...reconciled.issues])
      issueCounts[issue.code] = (issueCounts[issue.code] ?? 0) + 1;
    console.log(
      JSON.stringify({
        environment: "local-only",
        state: imported.state,
        changed: imported.changed,
        unchanged: imported.unchanged,
        copied,
        counts: reconciled.counts,
        structurallyReconciled: reconciled.structurallyReconciled,
        issueCounts,
        releaseReady: false,
      }),
    );
    if (imported.state !== "rehearsed" || !reconciled.structurallyReconciled)
      process.exitCode = 1;
  } catch {
    console.error(
      "Local rehearsal failed; private source values, SQL and credentials are withheld.",
    );
    process.exitCode = 1;
  } finally {
    await runtime?.dispose();
  }
}
