import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unstable_splitSqlQuery } from "wrangler";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { build } from "esbuild";
import {
  createProtectedDirectory,
  outsideRepository,
} from "../migration/private-files.ts";
import { sha256 } from "../../workers/jobs/src/providers.ts";
import type { IngestionBindings } from "../../workers/jobs/src/ingestion.ts";
export async function openShadowStore(destination: string, create = false) {
  const directory = create
    ? await createProtectedDirectory(destination)
    : await outsideRepository(destination);
  const markerPath = path.join(directory, "ingestion-shadow.json"),
    marker = { kind: "job-board-ingestion-shadow", version: 1 };
  if (create)
    await writeFile(markerPath, JSON.stringify(marker), {
      flag: "wx",
      mode: 0o600,
    });
  else if (
    JSON.stringify(JSON.parse(await readFile(markerPath, "utf8"))) !==
    JSON.stringify(marker)
  )
    throw new Error("Unrecognized shadow store");
  const configPath = path.join(directory, "wrangler.local.json");
  if (create)
    await writeFile(
      configPath,
      JSON.stringify({
        name: "ingestion-shadow-local",
        compatibility_date: "2026-09-11",
        d1_databases: [
          {
            binding: "DB",
            database_name: "ingestion-shadow-local",
            database_id: "LOCAL_ONLY",
          },
        ],
        r2_buckets: [
          { binding: "PRIVATE_FILES", bucket_name: "ingestion-shadow-local" },
        ],
      }),
      { flag: "wx", mode: 0o600 },
    );
  const config = JSON.parse(await readFile(configPath, "utf8")) as Record<
    string,
    unknown
  >;
  // Build a fresh known local-only config on every opening; never trust altered remote bindings.
  if (
    JSON.stringify(config) !==
    JSON.stringify({
      name: "ingestion-shadow-local",
      compatibility_date: "2026-09-11",
      d1_databases: [
        {
          binding: "DB",
          database_name: "ingestion-shadow-local",
          database_id: "LOCAL_ONLY",
        },
      ],
      r2_buckets: [
        { binding: "PRIVATE_FILES", bucket_name: "ingestion-shadow-local" },
      ],
    })
  )
    throw new Error("Unexpected shadow bindings");
  // The temporary harness is bundled outside the repo, executes next to native D1,
  // and is never part of either deployable Worker. No Node-per-query replay overhead.
  const enginePath = fileURLToPath(
    new URL("../../workers/jobs/src/ingestion.ts", import.meta.url).href,
  ).replaceAll("\\", "/");
  const entry = `import {advanceIngestion} from ${JSON.stringify(enginePath)};
export default {async fetch(request,env){
 if(request.method!=="POST" || new URL(request.url).pathname!=="/local-shadow")return new Response("Not found",{status:404});
 const {runId}=await request.json();
 if(typeof runId!=="string" || runId.length>100)return new Response("Invalid run",{status:400});
 try{for(let i=0;i<80;i++){const result=await advanceIngestion(env,runId,()=>Promise.reject(new Error("Shadow network disabled")));if(result.done)return Response.json(result);}return Response.json({done:false,state:"progress"});}
 catch{return Response.json({done:true,state:"failed"},{status:500});}
}};`;
  const bundle = await build({
    stdin: {
      contents: entry,
      resolveDir: fileURLToPath(new URL("../../", import.meta.url).href),
      sourcefile: "local-shadow.js",
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "esm",
    target: "es2022",
    external: ["cloudflare:*"],
  });
  const script = bundle.outputFiles[0].text,
    harnessPath = path.join(directory, "local-shadow-worker.mjs");
  await writeFile(harnessPath, script, { mode: 0o600 });
  const miniflare = new Miniflare(
    convertV4MiniflareOptions({
      name: "ingestion-shadow-local",
      modules: true,
      // Inline module bytes avoid Miniflare's Windows drive-letter module-path failure.
      script,
      compatibilityDate: "2026-09-11",
      compatibilityFlags: ["nodejs_compat"],
      host: "127.0.0.1",
      port: 0,
      d1Databases: { DB: "LOCAL_ONLY" },
      r2Buckets: { PRIVATE_FILES: "ingestion-shadow-local" },
      // Miniflare 5 uses one resource persistence path; legacy d1Persist/r2Persist
      // keys are ignored by its compatibility converter.
      resourcePersistencePath: path.join(directory, "state"),
      bindings: {
        INGESTION_WRITES_ENABLED: "true",
        CLOSURE_MAX_FRACTION: "0.1",
        CLOSURE_MAX_COUNT: "25",
      },
      outboundService: () => {
        throw new Error("Shadow network disabled");
      },
    }),
  );
  try {
    const localEnv = await miniflare.getBindings<IngestionBindings>();
    const db = localEnv.DB;
    await db
      .prepare(
        "CREATE TABLE IF NOT EXISTS local_migrations(name TEXT PRIMARY KEY,checksum TEXT NOT NULL)",
      )
      .run();
    const migrations = fileURLToPath(
      new URL("../../packages/data/migrations/", import.meta.url).href,
    );
    for (const name of (await readdir(migrations))
      .filter((n) => /^\d+_[a-z_]+\.sql$/.test(n))
      .sort()) {
      const sql = (await readFile(path.join(migrations, name), "utf8")).replace(
          /\r\n/g,
          "\n",
        ),
        checksum = await sha256(sql);
      const previous = await db
        .prepare("SELECT checksum FROM local_migrations WHERE name=?")
        .bind(name)
        .first<string>("checksum");
      if (previous) {
        if (previous !== checksum) throw new Error("Applied migration changed");
        continue;
      }
      await db.batch([
        ...unstable_splitSqlQuery(sql).map((s) => db.prepare(s)),
        db
          .prepare("INSERT INTO local_migrations(name,checksum) VALUES(?,?)")
          .bind(name, checksum),
      ]);
    }
    return {
      directory,
      env: {
        ...localEnv,
        INGESTION_WRITES_ENABLED: "true",
        CLOSURE_MAX_FRACTION: "0.1",
        CLOSURE_MAX_COUNT: "25",
      },
      async advance(runId: string) {
        const result = await miniflare.dispatchFetch(
          "http://localhost/local-shadow",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ runId }),
          },
        );
        if (!result.ok)
          throw new Error(
            "Local shadow ingestion failed; inspect redacted run state",
          );
        return (await result.json()) as { done: boolean; state: string };
      },
      harnessHash: await sha256(script),
      dispose: () => miniflare.dispose(),
    };
  } catch (e) {
    await miniflare.dispose();
    throw e;
  }
}
