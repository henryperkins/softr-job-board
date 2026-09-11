import { defineConfig } from "vitest/config";
import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./workers/app/wrangler.jsonc" },
      miniflare: {
        bindings: {
          APP_ORIGIN: "https://app.test",
          BETTER_AUTH_SECRET:
            "synthetic-test-secret-at-least-32-characters-long",
          WRITES_ENABLED: "true",
          MCP_ENABLED: "true",
          MCP_WRITES_ENABLED: "true",
          MCP_GENERATION_ENABLED: "true",
          MCP_REVIEW_ENABLED: "true",
          MIGRATIONS: await readD1Migrations("./packages/data/migrations"),
        },
      },
    }),
  ],
  test: { include: ["tests/integration/**/*.test.ts"], testTimeout: 30000 },
});
