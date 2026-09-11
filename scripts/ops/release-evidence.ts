import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";

/**
 * Post-write release closeout evidence checker.
 *
 * This tool only reads and reports. It never deploys, switches a route, restores
 * a database or retires a source, and a manifest that validates is explicitly
 * NOT an instruction to do any of those things — it records that the evidence
 * for a human decision exists.
 *
 * It fails closed. Every field below must be present and concrete; a blank, a
 * placeholder or an UNPROVISIONED id is a failure. Local test results are
 * recorded separately from deployed evidence and can never satisfy a deployed
 * requirement.
 *
 * It is not a pre-write gate: firstAcceptedTargetWriteAt must be observed, not
 * forecast. Follow docs/migration/release-evidence.md before enabling writes.
 *
 * Usage: node scripts/ops/release-evidence.ts <post-write-manifest.json>
 */

// Values that look filled in but are not.
const PLACEHOLDER =
  /^(?:|todo|tbd|n\/a|na|none|unknown|pending|changeme|xxx+|replace(?:_[a-z0-9]+)*|unprovisioned(?:_[a-z_]+)?|.*\.invalid)$/i;
const concrete = (label: string) =>
  z
    .string()
    .trim()
    .min(1)
    .refine((v) => !PLACEHOLDER.test(v), `${label} is still a placeholder`);

const passingCheck = z.strictObject({
  passed: z.literal(true),
  total: z.number().int().nonnegative(),
  command: concrete("command"),
});

const deployedWorker = z.strictObject({
  name: concrete("worker name"),
  // Cloudflare returns a version id per deployment. It is the only thing that
  // proves which build actually serves traffic.
  versionId: concrete("version id"),
  deployedAt: z.iso.datetime(),
});

export const releaseEvidenceSchema = z.strictObject({
  release: z.strictObject({
    environment: z.enum(["staging", "production"]),
    gitSha: z.string().regex(/^[0-9a-f]{40}$/, "gitSha must be a full SHA"),
    treeClean: z.literal(true),
    preparedAt: z.iso.datetime(),
    preparedBy: concrete("preparedBy"),
  }),
  // Local results are recorded but are never sufficient on their own.
  localChecks: z.strictObject({
    lint: passingCheck,
    typecheck: passingCheck,
    unit: passingCheck,
    integration: passingCheck,
    jobs: passingCheck,
    browser: passingCheck,
    dryBuilds: passingCheck,
  }),
  deployed: z.strictObject({
    appWorker: deployedWorker,
    backgroundWorker: deployedWorker,
    d1DatabaseId: concrete("d1DatabaseId"),
    r2Buckets: z.array(concrete("r2 bucket")).min(1),
    emailBinding: z.strictObject({
      name: concrete("email binding name"),
      allowedSenderAddresses: z.array(z.email()).min(1),
      mailFrom: z.email(),
    }),
    // A restore rehearsal that actually ran against the deployed database.
    d1Bookmark: concrete("d1Bookmark"),
    restoreRehearsedAt: z.iso.datetime(),
    deliveryVerifiedAt: z.iso.datetime(),
    isolationVerifiedAt: z.iso.datetime(),
  }),
  migrations: z
    .array(
      z.strictObject({
        name: z.string().regex(/^\d{4}_[a-z_]+\.sql$/),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
      }),
    )
    .min(1),
  releaseFlags: z.strictObject({
    writesEnabled: z.boolean(),
    generationEnabled: z.boolean(),
    mcpEnabled: z.boolean(),
    mcpWritesEnabled: z.boolean(),
    mcpGenerationEnabled: z.boolean(),
    mcpReviewEnabled: z.boolean(),
    mailMode: z.enum(["disabled", "cloudflare"]),
  }),
  sourceCutover: z.strictObject({
    finalExportHash: z.string().regex(/^[0-9a-f]{64}$/),
    attachmentManifestHash: z.string().regex(/^[0-9a-f]{64}$/),
    recordCount: z.number().int().positive(),
    // The source must stop accepting writes before the final export is trusted.
    writerFrozenAt: z.iso.datetime(),
    lastAcceptedSourceWriteAt: z.iso.datetime(),
    firstAcceptedTargetWriteAt: z.iso.datetime(),
  }),
  routing: z.strictObject({
    apexBefore: concrete("apexBefore"),
    apexAfter: concrete("apexAfter"),
    wwwBefore: concrete("wwwBefore"),
    wwwAfter: concrete("wwwAfter"),
    unrelatedRecordsPreserved: z.literal(true),
  }),
});

export type ReleaseEvidence = z.infer<typeof releaseEvidenceSchema>;

export async function migrationHashes(directory: string) {
  const names = (await readdir(directory))
    .filter((name) => /^\d{4}_[a-z_]+\.sql$/.test(name))
    .sort();
  const out: { name: string; sha256: string }[] = [];
  for (const name of names) {
    const sql = (await readFile(path.join(directory, name), "utf8")).replace(
      /\r\n/g,
      "\n",
    );
    out.push({
      name,
      sha256: createHash("sha256").update(sql).digest("hex"),
    });
  }
  return out;
}

export function checkOrdering(evidence: ReleaseEvidence) {
  const problems: string[] = [];
  const frozen = Date.parse(evidence.sourceCutover.writerFrozenAt);
  const lastSource = Date.parse(
    evidence.sourceCutover.lastAcceptedSourceWriteAt,
  );
  const firstTarget = Date.parse(
    evidence.sourceCutover.firstAcceptedTargetWriteAt,
  );
  if (lastSource > frozen)
    problems.push(
      "A source write was accepted after the writer freeze: the final export cannot be trusted.",
    );
  if (firstTarget < frozen)
    problems.push(
      "A target write was accepted before the source was frozen: the two systems both accepted writes.",
    );
  if (evidence.release.environment === "production") {
    if (!evidence.releaseFlags.writesEnabled)
      problems.push("Production release records writesEnabled=false.");
  }
  return problems;
}

export async function verify(evidence: unknown, migrationsDirectory: string) {
  const parsed = releaseEvidenceSchema.safeParse(evidence);
  if (!parsed.success)
    return {
      ok: false as const,
      problems: parsed.error.issues.map(
        (i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
      ),
    };
  const problems = checkOrdering(parsed.data);
  // The recorded migration hashes must match the files in this checkout, so a
  // manifest cannot describe a schema that was never applied here.
  const actual = await migrationHashes(migrationsDirectory);
  const recorded = new Map(
    parsed.data.migrations.map((m) => [m.name, m.sha256]),
  );
  for (const { name, sha256 } of actual) {
    const claimed = recorded.get(name);
    if (!claimed)
      problems.push(`Migration ${name} is missing from the manifest.`);
    else if (claimed !== sha256)
      problems.push(`Migration ${name} hash does not match this checkout.`);
  }
  for (const name of recorded.keys())
    if (!actual.some((m) => m.name === name))
      problems.push(
        `Manifest names migration ${name}, which is not in this checkout.`,
      );
  return problems.length
    ? { ok: false as const, problems }
    : { ok: true as const, problems: [] as string[], evidence: parsed.data };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const file = process.argv[2];
  if (!file)
    throw new Error(
      "Usage: node scripts/ops/release-evidence.ts <post-write-manifest.json>",
    );
  const directory = fileURLToPath(
    new URL("../../packages/data/migrations/", import.meta.url),
  );
  const result = await verify(
    JSON.parse(await readFile(file, "utf8")),
    directory,
  );
  if (result.ok) {
    console.log(
      "PASS: post-write release closeout evidence is complete. This records that a human may now decide; it authorizes nothing by itself.",
    );
  } else {
    console.error("FAIL: release evidence is incomplete.");
    for (const problem of result.problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
  }
}
