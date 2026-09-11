# Task 5 report — ready for scoped review

Implemented durable ingestion, provider adapters, plain Cloudflare Workflow, Chicago dispatcher, recoverable outbox, conservative source identity/ownership, closure protections, operator service functions, and a protected local shadow CLI. No commits, staging, pushes, deployments, mail, paid providers, private source exports, account claims, or subagents. Existing localhost:8787 preview was left running and returned HTTP 200 at final check.

## Accepted final shadow evidence

Only this reopened persistent store is accepted:

`C:/Users/htper/Documents/Codex/2026-09-11/files-mentioned-by-the-user-softr/work/ingestion-shadow-task5-persistent`

- First report: `shadow-report-1789134610820.json` at 2026-09-11T13:50:10.820Z. Anthropic 594 + Stripe 626 + Figma 156 = **1,376 created**, zero updated/closed/rejected/reviews. All three validated snapshots complete and imported.
- Reopened store, re-normalized the same original bytes under synthetic next-date run keys: `shadow-report-1789134706341.json` at 2026-09-11T13:51:46.340Z. **1,376 unchanged**, zero created/updated/closed/rejected/reviews, **zero new versions**. Original capturedAt 2026-09-11T12:35:10Z was retained, so this replay did not fabricate fresher source evidence.
- Both reports used final bundled harness SHA-256 `323587da83ec2526703ba362774163e5d0696f155db04bea582f37ca52cfde30`.
- Raw hashes: Anthropic `e24a8aa555b64ac1f89a53e74a7cfc497b6c8387a465dc7ccb48cc6fd3fdcc56`; Stripe `35fc7009bde871aad112f31dbd85b0af3b624bcf084d41ca88297627c68d3280`; Figma `e8ac5a982b959e04e2e01b5319aee1ed55e5b3c1c4fa67329004b90899b17f6c`.
- Stored raw sizes are 8,622,994 / 4,854,082 / 1,734,332 bytes. D1/R2 are physically persisted under state/d1 and state/r2. An additional native local-store regression disposes/reopens the runtime, reads exact raw R2 bytes, and proves a new-date unchanged import produces no additional version.
- Shadow invokes the same ingestion engine beside native D1 using a temporary bundled Worker outside the repository. Its fetcher and outbound service forbid provider network. It has no deployable test route; the production Worker continues to return 404. Shadow outbox rows intentionally remain pending because this replay bypasses actual Workflow creation. The real Workflow wrapper and outbox are tested separately with Cloudflare's native test runtime.

### Superseded diagnostics — NOT acceptance evidence

- `work/ingestion-shadow-task5`: earlier slow Node-to-D1 proxy run, with an older in-memory normalizer, terminated with Windows exit 3221226505 after partial progress. Preserved, not reused.
- `work/ingestion-shadow-task5-final`: early fast harness reports `shadow-report-1789134394675.json` and `shadow-report-1789134503305.json` were **ephemeral**, because Miniflare 5 ignores legacy d1Persist/r2Persist keys. The repeated run exposed this by reporting creates again. Preserved, explicitly superseded by the persistent store above. The harness now uses the installed current `resourcePersistencePath` API. A Windows absolute scriptPath startup failure was also isolated and fixed by passing bundled module bytes inline; a readable bundle copy remains in the protected directory.
- None of these issues involved a live source call, provisioned binding, production mutation or preview restart.

## Final validation

- `pnpm test:ingestion`: **21 tests passed** in native D1/R2/Workflows runtime (12.96 seconds on final source). Covers backlog >40, interrupted replay, same-date uniqueness, new-date unchanged content, legacy exact-URL alias preservation, stable owner, content-only refresh, saved references, board separation, closures/circuit breaker, malformed/rejected/duplicate rows, >2-page Jobven/Fantastic traversal, durable page bounds, salary unknowns/currency/unit, descriptions >6,000 characters, timeout/429/500/503/byte bounds and bounded retries, redaction, both 2026 Chicago DST transitions, per-source dispatch independence, create-response ambiguity, failed SQL atomic rollback, audited retry/restart ambiguity, actual Workflow wrapper, stale older-run reopening guard, abandoned final outbox lease, and inert HTML-to-text conversion.
- `node --test tests/unit/shadow-store.test.mjs`: **1 test passed**, local D1/R2 persistence across disposal/reopen plus unchanged re-normalization (5.91 seconds total).
- `pnpm test:unit`: **29 pre-existing tests passed** (run before adding the focused shadow-store test, so 30 total unit tests are now present).
- `pnpm test:integration`: **30 tests / 3 files passed**.
- `pnpm lint`: passed for app/data/domain/web and background sources.
- `pnpm typecheck`: passed for separate app and background projects. Background generated Env never merges into the app TypeScript project.
- `pnpm typecheck:migration`: passed. One parent-approved behavior-preserving .href adjustment in private-files.ts resolves current mixed Node/Worker URL typings.
- `pnpm exec tsc -p tsconfig.jobs.json`: passed again after the final persistence API correction.
- `pnpm build`: web build and both actual Wrangler dry-run bundles passed. App bundle 2,606.44 KiB (gzip 436.45); background 1,080.72 KiB (gzip 183.02). No deployment occurred.
- `pnpm cf:types:jobs`: generated binding/runtime types with explicit local/staging/production environments, each unprovisioned and disabled. All three background flags default false; app existing disabled flags preserved.
- A final formatting check found only the newly added unit test; it was formatted. No source semantics changed after the accepted final normalizer runs.

## Implementation and next-task interfaces

- New additive `0005_ingestion.sql`; applied 0001–0004 remain untouched. No 0006 was persisted by this task.
- Provider identities: greenhouse:anthropic/stripe/figma, fantastic:active-ats, jobven:public-jobs. External identity is `(source,external_id)`; no title/company merge. Legacy aliases/IDs/URLs remain. Exact job-specific canonical HTTPS URLs may reuse one unambiguous job. First committed owner is permanently recorded so alternate daily providers cannot fight over canonical content; their observations remain retained.
- `workers/jobs/src/providers.ts`: allowlist, schemas, full normalization/provenance, source request construction, offset/cursor validation, bounded/retried fetch, SHA-256. `html-text.ts` uses pinned parse5 8.0.1 to decode Greenhouse transport-escaped HTML, retain paragraph/list breaks, omit script/style/template/noscript and emit plain text; exact source HTML stays in sourceFields/raw R2.
- `workers/jobs/src/ingestion.ts`: `IngestionBindings`, `getRun`, `capturePage`, `advanceIngestion`, `markFailure`. Normalized versions have `{core,externalId,canonicalUrl,salary,tags,locations,companies,provenance,sourceFields}`; core matches current app job columns. Capture/staging/backlog progress and job/version/audit/action writes are atomic. Source-level and per-record monotonic guards prevent an older interrupted run from undoing newer observations/closure.
- `workers/jobs/src/dispatcher.ts`: `IngestParams={runId:string}`, `acquireRun`, `dispatchSchedule`, `drainOutbox`, `inspectRun`, `retryRun`, `recoverRestart`, `retryDispatch`. Outbox dispatcher consumes **only kind='ingest-source'**. Generation must add its own kind/dispatcher/binding and keep its independent flag false until authorized. Never repurpose ingestion IDs or date uniqueness for generation.
- `workers/jobs/src/index.ts`: `IngestSourceWorkflow extends WorkflowEntrypoint<JobsEnv,IngestParams>`; scheduled dispatcher; every public fetch 404. Raw pages never become Workflow step results. `INGEST_SOURCE` is a Workflow binding; `GENERATION_ENABLED=false` is only a reserved flag, not an implemented generation path.
- Trusted recovery functions validate failed/exhausted/stopped states, expected bounded retry revision and source freshness. Retry and dispatch reset actions are audited; successful dates/review states cannot silently rerun. No application role or fake operator header is introduced.
- Bounds: 20-second fetch/body timeout, 16 MiB response, 3 transient fetch attempts, 25 staging rows, 10 imported records per step, 200 pages per retry revision, 10,000 Workflow steps, at most 5 operator retry revisions, 200,000 normalized-record bytes, 200,000 HTML input bytes/50,000 traversal items. Exhaustion fails incomplete with retained backlog/cursor.
- Closure requires complete validated board and drained backlog, exact source ownership, max 25 removals and max 10% tracked open rows. Empty/rejected/partial/rolling absence never closes. Closure review records successful source observation separately from pending closure decision.

## Exact local shadow commands

```powershell
pnpm ingestion:shadow --snapshots C:/Users/htper/Documents/Codex/2026-09-11/files-mentioned-by-the-user-softr/work/source-providers/greenhouse-20260911 --local-store C:/Users/htper/Documents/Codex/2026-09-11/files-mentioned-by-the-user-softr/work/ingestion-shadow-task5-persistent --date 2026-09-11 --captured-at 2026-09-11T12:35:10Z --create
pnpm ingestion:shadow --snapshots C:/Users/htper/Documents/Codex/2026-09-11/files-mentioned-by-the-user-softr/work/source-providers/greenhouse-20260911 --local-store C:/Users/htper/Documents/Codex/2026-09-11/files-mentioned-by-the-user-softr/work/ingestion-shadow-task5-persistent --date 2026-09-12 --captured-at 2026-09-11T12:35:10Z
pnpm ingestion:inspect C:/Users/htper/Documents/Codex/2026-09-11/files-mentioned-by-the-user-softr/work/ingestion-shadow-task5-persistent ingest-greenhouse-anthropic-2026-09-12
```

The first command has already succeeded; do not rerun it with --create against the existing store. For future smoke replay use an unused protected output directory, or omit --create to inspect/replay the recognized store. The next-date key above is synthetic replay labeling, not a new live capture.

## Changed files (all task edits, not staged)

1. .github/workflows/checks.yml
2. package.json
3. pnpm-lock.yaml
4. scripts/migration/private-files.ts
5. workers/jobs/README.md
6. docs/ingestion.md
7. eslint.jobs.config.js
8. fixtures/ingestion/legacy-normalization.json
9. packages/data/migrations/0005_ingestion.sql
10. scripts/ingestion/inspect.ts
11. scripts/ingestion/local-store.ts
12. scripts/ingestion/shadow.ts
13. tests/jobs/ingestion.test.ts
14. tests/unit/shadow-store.test.mjs
15. tsconfig.jobs.json
16. vitest.jobs.config.ts
17. workers/jobs/src/dispatcher.ts
18. workers/jobs/src/html-text.ts
19. workers/jobs/src/index.ts
20. workers/jobs/src/ingestion.ts
21. workers/jobs/src/providers.ts
22. workers/jobs/worker-configuration.d.ts
23. workers/jobs/wrangler.jsonc

This ignored task-5-report.md is the handoff artifact, not a Git deliverable. Dependencies added: parse5 8.0.1; local-only development tooling miniflare 5.20260910.0-alpha and esbuild 0.28.1, matching Wrangler's installed dependencies.

## Remaining gates / limits

- Fantastic and Jobven have fixture/runtime coverage only. Credentials, paid/free quota entitlements, real pagination and live acceptance remain pending. No claim that they passed live acceptance.
- Final public shadow starts empty and contains no private exported rows. Legacy reuse is verified with a synthetic D1 adoption case and the parent's separate aggregate evidence, not a private full-export adoption in this task. The eight absent legacy Greenhouse rows remain outside cutover closure authorization.
- Normalizer/parser changes need a new successful source/date or reviewed failed-run replay; immutable malformed captures remain evidence and cannot be edited away. Extremely large individual records fail visibly instead of being truncated.
- Source ownership is stable first-committer ownership, not automatic changing provider priority. Changing it or overriding closure review requires a separate reviewed operation.
- Remote provisioning, production schedules, operator deployment tooling, live acceptance and cutover are not implied. Generation/MCP remain for subsequent reviewed tasks.

Implementation stopped after this report for parent staging and scoped review.
