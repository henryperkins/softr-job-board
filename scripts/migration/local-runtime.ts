import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPlatformProxy, unstable_splitSqlQuery } from "wrangler";
import {
  createProtectedDirectory,
  outsideRepository,
} from "./private-files.ts";
import { recordHash } from "./validate-export.ts";
import type { MigrationDatabase } from "./import-d1.ts";
import type { PrivateBucket } from "./reconcile.ts";

const marker = { kind: "softr-job-board-local-rehearsal", version: 1 };
export async function openLocalMigration(destination: string) {
  let directory: string;
  try {
    directory = await outsideRepository(destination);
    if (
      recordHash(
        JSON.parse(
          await readFile(path.join(directory, "rehearsal.json"), "utf8"),
        ),
      ) !== recordHash(marker)
    )
      throw new Error("Unrecognized local migration store.");
  } catch (error) {
    if (
      !error ||
      typeof error !== "object" ||
      !("code" in error) ||
      error.code !== "ENOENT"
    )
      throw error;
    directory = await createProtectedDirectory(destination);
    await writeFile(
      path.join(directory, "rehearsal.json"),
      JSON.stringify(marker),
      { flag: "wx", mode: 0o600 },
    );
  }
  // This dedicated config contains no production bindings, routes, credentials or application secrets.
  const configPath = path.join(directory, "wrangler.local.json");
  await writeFile(
    configPath,
    JSON.stringify({
      name: "job-board-migration-local",
      compatibility_date: "2026-09-11",
      d1_databases: [
        {
          binding: "DB",
          database_name: "job-board-migration-local",
          database_id: "LOCAL_ONLY",
        },
      ],
      r2_buckets: [
        { binding: "PRIVATE_FILES", bucket_name: "job-board-migration-local" },
      ],
    }),
    { mode: 0o600 },
  );
  const proxy = await getPlatformProxy<{
    DB: MigrationDatabase;
    PRIVATE_FILES: PrivateBucket;
  }>({
    configPath,
    envFiles: [],
    persist: { path: path.join(directory, "state") },
    remoteBindings: false,
  });
  try {
    const db = proxy.env.DB;
    await db
      .prepare(
        "CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL)",
      )
      .run();
    const migrationDirectory = fileURLToPath(
      new URL("../../packages/data/migrations/", import.meta.url),
    );
    for (const name of (await readdir(migrationDirectory))
      .filter((name) => /^\d+_[a-z_]+\.sql$/.test(name))
      .sort()) {
      const sql = (
        await readFile(path.join(migrationDirectory, name), "utf8")
      ).replace(/\r\n/g, "\n");
      const checksum = recordHash(sql);
      const applied = await db
        .prepare("SELECT checksum FROM local_migrations WHERE name=?")
        .bind(name)
        .first<{ checksum: string }>();
      if (applied) {
        if (applied.checksum !== checksum)
          throw new Error(
            "Applied local migration changed; use a new rehearsal store.",
          );
        continue;
      }
      await db.batch([
        ...unstable_splitSqlQuery(sql).map((query) => db.prepare(query)),
        db
          .prepare("INSERT INTO local_migrations (name,checksum) VALUES (?,?)")
          .bind(name, checksum),
      ]);
    }
    return {
      directory,
      db,
      files: proxy.env.PRIVATE_FILES,
      dispose: proxy.dispose,
    };
  } catch (error) {
    await proxy.dispose();
    throw error;
  }
}
