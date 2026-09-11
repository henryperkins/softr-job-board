import { openShadowStore } from "./local-store.ts";
import { inspectRun } from "../../workers/jobs/src/dispatcher.ts";
const [directory, runId] = process.argv.slice(2);
if (!directory || !runId)
  throw new Error(
    "Usage: node scripts/ingestion/inspect.ts <recognized-shadow-store> <run-id>",
  );
const runtime = await openShadowStore(directory);
try {
  console.log(JSON.stringify(await inspectRun(runtime.env.DB, runId), null, 2));
} finally {
  await runtime.dispose();
}
