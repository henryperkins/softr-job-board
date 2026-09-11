# Task 6 — ready for scoped review

Implemented scoped generation, durable private provenance, conservative Anthropic output validation, minute outbox dispatch, and request/review UI. Task edits are **unstaged**. No subagents, staging/commits/push/deploy, remote provisioning, live provider calls, mail, secrets reads, protected archive reads, account migration/claiming or MCP implementation. Applied 0001–0005 SQL remains unchanged.

The stable localhost:8787 preview remained untouched and returned HTTP200 at final check. Browser acceptance used an isolated synthetic preview at8896 (inspector9896), after confirming those ports were unused. The harness stopped itself after the test.

## Design decisions

- Authenticated requests name exactly one saved job, chosen profile and immutable profile version, current job version, idempotency key, and explicit draft/expectedRevision for regeneration. Wrong-owner, mismatched parent/version, archived, missing, unsupported legacy profile and empty evidence cases fail closed.
- Native D1 acceptance is one transactional batch: race-safe limits and current ownership/revision predicates; one missing draft if appropriate; request/immutable manifest; recoverable snapshot state; outbox; audit; and guarded status-only saved summary update. Identical owner/key/intent returns the request; changed intent conflicts. Extra request fields, including caller model, fail strict validation.
- Defaults: five accepted requests per rolling24hours; two in-flight per user; one in-flight per saved job. Trusted app vars are configurable within bounds20/day and5in-flight. Concurrent **different saved jobs** are tested, so the limit test does not rely only on per-save uniqueness.
- Request queued/running state is independent from last-good draft content. New generation drafts allow edits while pending. Finalization checks original draft and approval revision, owner/profile archive predicates and permitted saved outcomes. A concurrent edit/approval/submission wins. Native transaction rollback keeps prior versions/content/summary/audit consistent. Saved summary updates never copy stale notes/priority/outcome fields.
- Snapshot bytes are allowlisted before hashing: selected profile headline/summary/experience/education/skills, and job title/company/description/location/remote/employment/seniority. Full source archives, Recommended For relationships, rosters, profile email/URLs/preferences/attachment metadata are never provider input. Immutable original-version hashes preserve provenance without forwarding archived fields.
- Private R2 input keys have D1 size/hash manifests and pending/ready state. Rebuild/replay validates immutable source hashes plus stored exact bytes. Outputs are privately stored and hashed before finalization. Lost R2 acknowledgment and failed SQL finalization recover from stored bytes without a second call.
- Output contract extractive-letter-v1 is intentionally constrained: Anthropic selects1–8 exact evidence IDs; the server produces a readable quotation-based letter with a fixed opening/closing. The provider cannot add free-form factual sentences. Numerical/employer/credential claims appear only as exact attributed unverified user quotations. These claims may still be false or irrelevant. Required review and deterministic gap questions are visible. No inferred screening questions are generated.
- All resume use is rejected after owner/profile/version-parent checks. ResumeContentsUsed=false is persisted/returned. No untested PDF parser; the actionable path is to add evidence to a fresh profile and choose that immutable version. Clean files are also unsupported, not silently treated as evidence.
- Fixed Anthropic Messages endpoint, x-api-key compatibility header, anthropic-version2023-06-01, output_config.format JSON schema, model claude-opus-5, no tools/redirects, input96,000bytes, response64,000bytes, deadline20seconds, max_tokens1024. No beta header needed per current docs.
- Before every external call, D1 records a bounded attempt. Only definitive429 permits a second attempt; maximum2. Network/lost acceptance/5xx becomes provider_acceptance_unknown with no silent automatic retry. Explicit new requests can incur another charge. Exactly-once billing is not promised.
- State/attempt provenance includes actor/request/saved job, immutable job/profile references and hashes, input hash, server model/contract, provider request/message IDs, response model, finish reason, token usage, timestamps, validation outcome and exact immutable draft-version result.
- GenerateDraftWorkflow uses small durable step results. Minute dispatch consumes only generate-draft events, up to10 per invocation, with25 active-instance reconciliations. Deterministic generate-<request-id>, same-ID status handling after ambiguous create, five dispatch attempts, bounded leases/delays, abandoned-final-lease failure, and exhausted Workflow reconciliation retain truthful state. Ingestion acquisition and ingestion dispatcher still run hourly, with existing Chicago date/five-source rules.
- App request and background execution switches remain false in all configurations. No new public background route (fetch stays404), no Queues/Agents/DO/provider replacement. The UI states unavailable honestly while disabled.
- Saved details polls only statuses without remounting editors. Explicit profile/version selection, request/regenerate, pending/failed/ambiguous state, evidence/gaps and review remain visible. “Refresh details, keep my edits” merges clean fields with latest summary; “Compare latest draft” makes replacement/rebasing explicit. Approval remains separate and never submits.

## TDD and failure evidence

1. Initial five native tests failed against intentionally unimplemented stubs: duplicate acceptance, explicit owner checks, immutable/private provider input and repeat finalization, editing while provider runs, and timeout acceptance ambiguity. The same five passed after implementation.
2. Three later substantive tests first failed and then passed:
   - truncated output lost finish/message/usage/failure provenance;
   - delivered exhausted Workflow left its D1 request active forever;
   - successful R2 response write with lost acknowledgment was incorrectly made terminal instead of recoverable.
3. Provider malformed/refused/truncated/empty/oversized/wrong-model/invented-ID/extra-free-form cases are native contract fixtures. Cross-profile privacy, version/attachment relationship rejection, immutable manifest/corrupt R2, actual quota races, approval/edit/submission races, SQL rollback, R2 recovery and deterministic dispatcher are native D1/R2 tests.
4. Real GenerateDraftWorkflow was executed in Cloudflare's native test runtime with a scoped Vitest global fetch spy, asserting only the fixed Anthropic endpoint and small {done,state} output. The installed cloudflare:test no longer exports fetchMock; an initial obsolete helper failure was corrected to vi.spyOn. Direct repeated execution/storage-failure replay verifies restart/idempotence logic; no deployed Workflow restart or live billing behavior was exercised.
5. fixtures/generation/evaluation.json contains synthetic expected accepted/rejected claims and required-review outcomes. These are deterministic contract tests, **not live model-quality evaluation**.

## Final validation and metrics

- pnpm test:generation: **35 passed**, final7.86seconds total (4.94seconds tests).
- pnpm test:jobs: **58 passed /2files** before adding two further limit/outcome tests,16.14seconds total. Both new tests passed focused, and final35-test generation suite passed. Existing ingestion portion: **25 passed** in that combined run. Current complete background inventory is60tests; do not report that a single final60-test combined command was run.
- pnpm test:unit: **30 passed**,22.92seconds.
- pnpm test:integration: **31 passed /4files**,17.60seconds. Includes authenticated generation acceptance/owner-only status/strict model rejection/disabled readiness/queued editing with fresh Better Auth accounts.
- pnpm lint: passed after correcting stream chunk narrowing for current runtime types.
- pnpm typecheck: passed separate app/background projects.
- pnpm typecheck:web and pnpm typecheck:migration: passed.
- pnpm build: web plus both actual local Wrangler dry-run bundles passed. App2,622.51KiB (gzip440.28); jobs1,138.95KiB (gzip195.50). No deploy.
- pnpm cf:types:jobs and pnpm cf:types: regenerated current bindings/runtime types; background type project remains separate.
- pnpm exec wrangler deploy --dry-run --env staging --config workers/app/wrangler.jsonc --outdir ../../dist/app-staging-check: passed after the separately user-requested sender config; output confirms EMAIL sender restriction. Same app bundle size; no deployment.
- PowerShell: $env:SYNTHETIC_PORT='8896'; $env:SYNTHETIC_GENERATION='true'; pnpm exec playwright test tests/e2e/generation.spec.ts: **1 passed**,20.4seconds overall/6.7seconds test. Actual app/D1 queued acceptance and reload persistence; saved-form conflict retains edited notes; draft text survives polling; synthetic intercepted failure status shows billing ambiguity while retaining text. Desktop1280/mobile390 no overflow or page errors.
- Screenshots visually inspected: work/task-6-browser/generation-1280.png and generation-390.png. Browser failure transition is explicitly intercepted synthetic UI evidence; successful provider-finalized browser content and live generation are not claimed.
- git diff --check: passed (only expected Git LF→CRLF notices).
- Prettier passed on changed supported file types after formatting; SQL has no configured Prettier parser and was not reformatted with an invented parser.
- Final stable preview check: localhost8787/login HTTP200.

## User-requested mail configuration addition

Parent relayed explicit sender no-reply@auth.lakefrontdev.com and independently verified its onboarded DNS-ready domain. Within this task's existing Wrangler ownership, staging and production now each declare a non-inherited send_email EMAIL binding with allowed_sender_addresses restricted to that exact address, plus matching MAIL_FROM. MAIL_MODE stays disabled; local retains no EMAIL binding. Existing structured EMAIL.send() auth code was unchanged. No REST token, delivery, provision or remote mail test was performed. Parent owns the independent sender/DNS evidence.

## Changed files

1. .github/workflows/checks.yml
2. apps/web/src/api.ts
3. apps/web/src/routes/saved.tsx
4. apps/web/src/routes/generation.tsx
5. package.json
6. packages/data/migrations/0006_generation.sql
7. packages/data/src/generation.ts
8. packages/data/src/services.ts
9. packages/domain/src/generation.ts
10. tests/e2e/preview.mjs
11. tests/e2e/generation.spec.ts
12. tests/integration/generation.test.ts
13. tests/jobs/generation.test.ts
14. vitest.jobs.config.ts
15. fixtures/generation/evaluation.json
16. workers/app/src/index.ts
17. workers/app/worker-configuration.d.ts
18. workers/app/wrangler.jsonc
19. workers/jobs/README.md
20. workers/jobs/src/anthropic.ts
21. workers/jobs/src/generation.ts
22. workers/jobs/src/generation-dispatcher.ts
23. workers/jobs/src/index.ts
24. workers/jobs/worker-configuration.d.ts
25. workers/jobs/wrangler.jsonc
26. docs/generation.md

No dependency or lockfile changes. Scripts now distinguish focused test:ingestion and test:generation from combined test:jobs; CI uses test:jobs and separately opts in to the isolated generation browser test. Parent-owned staged migration/release docs were not changed.

## Remaining gates and limits

- ANTHROPIC_API_KEY absent; Models API account access and exact selected model capability are **unverified**. Official current docs show claude-opus-5, but that does not establish entitlement. The runbook gives operator GET /v1/models and GET /v1/models/claude-opus-5 preflight and requires a workspace-scoped key.
- Representative human evaluation of relevance, evidence selection, quote context, privacy/injection handling and readable letter quality is **unrun** and required before enablement. Extractive letters may read less naturally; no free-form output is accepted as an escape hatch.
- Resume extraction remains unsupported; users must explicitly provide profile evidence. No private legacy archive was used as a fixture.
- No remote resource provisioning, route activation, provider invocation, mail, deployed Workflow restart or complete browser-to-live-model flow. Enablement/deployment and real billing behavior remain separate gates.
- Config switches cannot revoke an already accepted external call. Workflow version/config behavior during shutdown must be verified in deployed acceptance; the runbook explicitly calls this out.
- Status offers the latest10 requests and up to200 profile/version options. These are bounded UI views; the owner-only request-status API preserves older request access by ID.
- No live model quality, hallucination-free, external submission or migration activation claim. Generation success does not approve a draft.
- Stop for parent scoped review. Do not begin MCP or stage these edits from this implementation task.

