import { defineConfig } from "vitest/config";
import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./workers/jobs/wrangler.jsonc" },
      miniflare: {
        bindings: {
          INGESTION_WRITES_ENABLED: "true",
          GENERATION_ENABLED: "true",
          ANTHROPIC_API_KEY: "synthetic-test-key-no-provider-access",
          MIGRATIONS: await readD1Migrations("./packages/data/migrations"),
        },
      },
    }),
  ],
  test: { include: ["tests/jobs/**/*.test.ts"], testTimeout: 60000 },
});
