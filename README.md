# AI Jobs

A private job-search application being migrated from Softr to Cloudflare. The local implementation uses two Cloudflare Workers, D1, private R2, React/Vite, Better Auth, and a user-scoped OAuth MCP server.

This repository is not a production-release claim. No application Worker, D1 database, R2 bucket, route, or application MCP endpoint has been deployed from this branch. User writes, generation, mail, MCP transport, MCP writes, MCP generation, and MCP review are disabled by default.

## Application layout

- `workers/app` serves the web application, Better Auth, owner-scoped business APIs, OAuth consent and the Streamable HTTP MCP resource.
- `workers/jobs` runs ingestion and draft-generation workflows separately from requests.
- `packages/data/migrations` contains additive D1 migrations. Migrations `0001` through `0006` are frozen reviewed history; `0007_mcp.sql` adds OAuth/MCP state.
- `apps/web` contains the React interface.
- `docs/migration` contains the parity contract, cutover/rollback procedures and release-evidence workflow.
- `docs/softr-workspace.md` is dated source evidence from the Softr builder workspace. It is not the target application's runtime documentation.

## Local setup

Requires Node.js 24 and pnpm 10.34.5.

```bash
pnpm install --frozen-lockfile
pnpm build:web
pnpm dev
```

The normal local Worker uses `http://localhost:8787` and keeps `WRITES_ENABLED`, `GENERATION_ENABLED`, `MCP_ENABLED`, `MCP_WRITES_ENABLED`, `MCP_GENERATION_ENABLED`, and `MCP_REVIEW_ENABLED` false. Synthetic browser acceptance uses disposable local D1/R2 state and a separate port:

```powershell
$env:SYNTHETIC_PORT = "8899"
$env:SYNTHETIC_MCP = "true"
pnpm exec playwright test tests/e2e/mcp.spec.ts
```

That command enables MCP only in the disposable local process. It does not send mail, invoke a model/provider, create cloud resources, or deploy.

## Verification commands

```bash
pnpm lint
pnpm typecheck
pnpm typecheck:web
pnpm typecheck:migration
pnpm test:unit
pnpm test:integration
pnpm test:jobs
pnpm build
pnpm test:e2e
```

The default end-to-end command skips generation and MCP cases that require explicit isolated flags. CI runs those cases separately with their required synthetic ports and flags.

## MCP connections

There are two unrelated MCP surfaces:

1. The **application user MCP** acts as one signed-in AI Jobs user and can reach only that user's profiles, saved jobs and drafts. Its scopes, consent, revocation and Codex setup are documented in [Connect an AI assistant](docs/connect-ai-assistant.md#application-user-mcp).
2. The checked-in `.mcp.json` points to the historical **Softr workspace administration MCP** used to inspect the builder workspace. It can administer source apps, databases and workflows and is not an AI Jobs user grant.

Do not replace `.mcp.json` with the application endpoint. Each operator decides locally whether to authorize the source-workspace connector.

## Operations and release state

Read-only local diagnostics are available through:

```bash
node scripts/ops/diagnostics.ts <recognized-local-store>
```

Diagnostics refuses missing or unrecognized stores and copies the existing local D1 file plus any WAL/SHM sidecars into disposable storage before opening SQLite. It hashes the complete source set before and after each copy and accepts only byte-identical captured files; an active checkpoint or writer is retried at most three times and then fails with an instruction to stop writers. It applies no migration and reports repository migration drift alongside bounded backlog, allowlisted dispatch reasons, usage, and grant aggregates without changing the original store.

The release process has separate [pre-write and post-write evidence gates](docs/migration/release-evidence.md). The release-evidence checker validates only a completed post-write closeout manifest:

```bash
node scripts/ops/release-evidence.ts <completed-post-write-manifest.json>
```

A passing manifest records evidence for a human decision. It never deploys, switches DNS, restores data, enables a flag, or retires Softr.
