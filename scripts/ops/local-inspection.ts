import { DatabaseSync } from "node:sqlite";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { outsideRepository } from "../migration/private-files.ts";
import { recordHash } from "../migration/validate-export.ts";

const marker = { kind: "softr-job-board-local-rehearsal", version: 1 };
const sqliteSuffixes = ["", "-wal", "-shm"] as const;
const captureAttempts = 3;

function isMissing(error: unknown) {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

async function sqliteFingerprint(file: string) {
  return Promise.all(
    sqliteSuffixes.map(async (suffix) => {
      try {
        return createHash("sha256")
          .update(await readFile(file + suffix))
          .digest("hex");
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    }),
  );
}

const fingerprintsMatch = (
  left: readonly (string | null)[],
  right: readonly (string | null)[],
) => left.every((value, index) => value === right[index]);

async function captureSqlite(
  file: string,
  directory: string,
  filesystem: { copyFile: typeof copyFile },
) {
  for (let attempt = 1; attempt <= captureAttempts; attempt += 1) {
    const attemptDirectory = path.join(directory, `attempt-${attempt}`);
    const copy = path.join(attemptDirectory, "inspection.sqlite");
    await mkdir(attemptDirectory, { recursive: true });
    const before = await sqliteFingerprint(file);
    let complete = true;
    try {
      for (const [index, suffix] of sqliteSuffixes.entries()) {
        if (before[index] === null) continue;
        await filesystem.copyFile(file + suffix, copy + suffix);
      }
    } catch (error) {
      if (isMissing(error)) complete = false;
      else throw error;
    }
    const after = await sqliteFingerprint(file);
    const captured = complete ? await sqliteFingerprint(copy) : [];
    if (
      complete &&
      fingerprintsMatch(before, after) &&
      fingerprintsMatch(before, captured)
    )
      return copy;
    await rm(attemptDirectory, { recursive: true, force: true });
  }
  throw new Error(
    `Local migration store changed during ${captureAttempts} snapshot attempts. Stop its writers and retry.`,
  );
}

async function sqliteFiles(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await sqliteFiles(file)));
    else if (entry.isFile() && entry.name.endsWith(".sqlite")) found.push(file);
  }
  return found;
}

/** Inspects a disposable copy of a recognized rehearsal D1 file and sidecars. */
export async function openLocalInspection(
  destination: string,
  filesystem: { copyFile: typeof copyFile } = { copyFile },
) {
  const directory = await outsideRepository(destination);
  if (
    recordHash(
      JSON.parse(
        await readFile(path.join(directory, "rehearsal.json"), "utf8"),
      ),
    ) !== recordHash(marker)
  )
    throw new Error("Unrecognized local migration store.");
  await readFile(path.join(directory, "wrangler.local.json"), "utf8");
  const files = await sqliteFiles(path.join(directory, "state"));
  const sourceCandidates = files.filter(
    (file) =>
      file.split(path.sep).includes("d1") &&
      path.basename(file) !== "metadata.sqlite",
  );
  const scratch = await mkdtemp(
    path.join(os.tmpdir(), "job-board-diagnostics-"),
  );
  const candidates: DatabaseSync[] = [];
  try {
    for (const [index, file] of sourceCandidates.entries()) {
      const copyDirectory = path.join(scratch, String(index));
      await mkdir(copyDirectory, { recursive: true });
      const copy = await captureSqlite(file, copyDirectory, filesystem);
      const candidate = new DatabaseSync(copy, { readOnly: true });
      const recognized = candidate
        .prepare(
          "SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='local_migrations'",
        )
        .get();
      if (recognized) candidates.push(candidate);
      else candidate.close();
    }
  } catch (error) {
    for (const candidate of candidates) candidate.close();
    await rm(scratch, { recursive: true, force: true });
    throw error;
  }
  if (candidates.length !== 1) {
    for (const candidate of candidates) candidate.close();
    await rm(scratch, { recursive: true, force: true });
    throw new Error(
      `Expected one existing recognized local D1 file; found ${candidates.length}.`,
    );
  }
  const sqlite = candidates[0];
  return {
    directory,
    db: {
      prepare(sql: string) {
        const statement = sqlite.prepare(sql);
        return {
          async all<T>() {
            return { results: statement.all() as T[] };
          },
          async first<T>() {
            return (statement.get() as T | undefined) ?? null;
          },
        };
      },
    },
    dispose: async () => {
      sqlite.close();
      await rm(scratch, { recursive: true, force: true });
    },
  };
}
