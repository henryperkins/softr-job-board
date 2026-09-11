# Phase 7 independent review

Review date: September 11, 2026.

**Specification verdict: issues found. Phase 7 is not yet spec compliant.**

**Code-quality verdict: needs fixes.**

Reviewed the task brief, continuation brief, implementer report and frozen 31-file patch against Phase 1–6 index tree `64f93b5d350664320a8c1f3d0c977f337b1cd7d4`. Independently verified patch SHA-256 `86c120fe1f898613b873d27c44a9f2a66e398caf71d48f79ee5ec3b22eaeff25`. No code, index or Git mutations were made. Only this report and bounded ignored synthetic reproducer files were written.

## Actionable material findings

### R1 — P1: an outstanding authorization code restores a disconnected grant

**Location:** `workers/app/src/index.ts:273–283`, the Account disconnect transaction.

Disconnect deletes existing access tokens, refresh tokens and the consent, but leaves previously issued authorization codes valid. The resource server checks active token/session/user/audience, not whether the underlying user/client grant was revoked. A client can obtain a code before disconnect, redeem it afterward, and regain access without fresh consent. It then has a live token while the connected-app listing has no consent to display or revoke.

**Confirmed native reproduction:** issue a second authorization code for an existing grant; call Account disconnect; redeem that code with its valid PKCE verifier. Token exchange returned **200**, and the new token called MCP **200**. This is a revocation defect, not a future deployment gate.

Make the revocation boundary durable across pending issuance and token validation, using maintained provider mechanisms/hooks and an authoritative grant generation or equivalent revocation state as necessary. Ensure neither pending codes nor issuance racing with disconnect can restore authority; later explicit re-consent must not revalidate older credentials. Add a regression for the demonstrated sequence and the issuance boundary.

### R2 — P1: the exposed provider consent-delete route leaves live access behind

**Location:** `workers/app/src/index.ts:102–106` and the general `/auth/*` forwarding handler.

`/auth/oauth2/delete-consent` is explicitly kept reachable even with MCP disabled. The installed provider's `deleteConsentEndpoint` only deletes `oauthConsent`; it does not revoke access/refresh tokens. Calling it removes the application from Account while its bearer credentials remain usable. The application added a safer disconnect route but still exposes this bypass.

**Confirmed native reproduction:** authenticated POST to `/auth/oauth2/delete-consent` returned **200**; the original token immediately called MCP **200**. Installed source corroboration: `@better-auth/oauth-provider/dist/authorize-zWEGx4ky.mjs:2989–3015`.

Block this alternate mutation or route it through the same complete grant-revocation implementation. Review the exposed provider consent-update surface as well so management actions cannot give a misleading view of effective authority. Preserve owner and Origin checks.

### R3 — P1: authorization started while signed out loses its continuation

**Location:** `workers/app/src/auth.ts:102`; `apps/web/src/routes/auth.tsx:37–44,84,182`.

The provider redirects an unauthenticated authorization request to `/login?<signed OAuth parameters>`. The login form sends only `{email,password}`, reads only `next-page`, and then navigates to `/`. It never passes the signed `oauth_query` through the maintained provider continuation hook or handles the resulting authorization response. Signup navigation, verification callback and resend callback also discard that continuation. Adding `/consent` to `safeNext` only helps users already at that page; it does not repair this normal OAuth entry path.

Installed provider source at `authorize-zWEGx4ky.mjs:5734–5743` constructs this login URL; its hooks at `4447–4506` consume and validate `oauth_query` and continue authorization after session creation.

Preserve the signed request through login and fresh signup/verification with the provider's validated continuation flow and safe redirect handling. Add browser acceptance that starts authorization in a signed-out context. The delivered browser test calls `login(page)` first (`tests/e2e/mcp.spec.ts:176`), so it misses this defect.

### R4 — P2: the promised independent MCP mutation/review release gates do not exist

**Location:** `workers/app/src/mcp/tools.ts:59,93–95,166–168`.

All non-read tools depend on the common application `WRITES_ENABLED` switch. Generation additionally uses `GENERATION_ENABLED`, but approval has no independent review release gate. The current environment contract/configuration contains only `MCP_ENABLED`, `WRITES_ENABLED` and `GENERATION_ENABLED`. Enabling ordinary application writes and MCP therefore makes approval executable for any already-approved review scope; operators cannot independently hold MCP review back, or keep MCP read-only while ordinary UI/API writes remain enabled.

Implement the task's independent MCP capability release controls, defaulting off, and cover each disabled capability through the actual transport. Correct report lines 54 and 65, which currently assert independent review gating. Distinct OAuth scopes are useful but do not substitute for release gates.

### R5 — P2: the “read-only” diagnostics CLI applies migrations

**Location:** `scripts/ops/diagnostics.ts:133`.

The command calls `openLocalMigration`, which creates missing store/config files, creates the migration ledger and applies every missing migration in a D1 batch (`scripts/migration/local-runtime.ts:25–43,71–104`). Running the documented diagnostics command on a preserved Phase 1–6 rehearsal applies 0007 before collecting counts; a nonexistent destination can become a new store. This contradicts its read-only operational contract and can change preserved rehearsal evidence.

Use an inspection-only opening path that requires an existing recognized store, does not rewrite configuration or apply schema, and reports missing/drifted migrations as evidence. Add a synthetic test that compares files/ledger/schema before and after diagnostics on a store with a pending migration. This finding is established from the shared opener's implementation; no protected store was opened during review.

### R6 — P2: required security/transport coverage is missing and replay claims are overstated

**Location:** `tests/integration/mcp.test.ts:492–512`, `tests/e2e/mcp.spec.ts:176`, and `task-7-report.md:146,175`.

The test titled “refreshing rotates the refresh token and the old one stops working” never submits the old refresh token again and does not even assert refresh-token rotation. The installed MCP wrapper defaults `refreshTokenReuseInterval` to **30 seconds** (`@better-auth/mcp/dist/index.mjs`); app options do not override it. The focused reproducer observed an immediate repeated refresh returning **200** with the same rotated response. This is maintained retry-window behavior, not inherently a provider defect, but the intended policy and its limits are neither explicit nor verified.

Make that policy explicit: either configure strict no-reuse behavior or document/test the bounded replay window, its expiration, mismatched replay requests and family invalidation. Add the other expressly required missing cases: expired real access/code/refresh credentials, cross-client code/refresh misuse, current-user/session invalidation, tampered consent continuation, and successful queued generation through MCP. The current generation test only checks the disabled case. The native “same client” re-consent test actually registers a new client through `connect`; the browser test does correctly reuse the original client.

Use an actual SDK client for at least one local supported transport flow. The claim that the retained 1.30 SDK cannot be used because the server is 2.0 is not supported: installed `createMcpHandler` documentation/source (`@modelcontextprotocol/server/dist/index.mjs:1162–1216`) explicitly provides default legacy stateless fallback for 2025-era clients. Both delivered MCP suites instead handcraft only the 2026 envelope. This local feasibility gap is separate from required deployed Codex acceptance.

Narrow the implementer report's blanket claim that every required security/replay/protocol case is covered until the actual assertions exist.

### R7 — P2: the operational signals claimed by the report are incomplete

**Location:** `scripts/ops/diagnostics.ts:38–60,103–104`; `workers/app/src/mcp/tools.ts:104–105`; `workers/app/src/observability.ts:5–9`.

Diagnostics never reads ingestion backlog, dispatch error reasons, generation usage, or a migration drift comparison. It reports run states, outbox age/attempt counts, generation attempt states and import-manifest counts instead. Consequently a growing ingestion backlog, usage/cost change or migration mismatch cannot be assessed through the described report. The `mcp_tool_rejected` event is declared but never emitted; tool authorization/validation failures become in-band errors while the outer log records a completed HTTP 200.

Add bounded fixed-query aggregates for the specifically required missing signals and emit finite tool-rejection events at the appropriate dispatch/validation boundary, without raw inputs or exceptions. Do not claim “generation attempts/usage” and “migration drift” (implementer report line 77) or tool-rejection observability until they are represented. Keep deployment thresholds configurable choices.

## Evidence and strengths

- Maintained opaque-token validation checks persisted token expiry/revocation, client state and bound-session validity. App code additionally requires the current verified user and exact resource, then resolves the shared immutable business actor. The provider's opaque introspection builds the issuer from the configured local provider context; it does not trust a caller-supplied issuer.
- Strict tool inputs reject unknown identity/model/URL authority; services retain owner checks, profile-create idempotency and optimistic revision behavior. Read/write/generate/review scopes are meaningfully separated.
- The new migration is additive, and the reviewed delta does not modify 0001–0006.
- DCR metadata is rendered as unverified text. CIMD is absent; the installed provider also limits registered JWKS URI targets to trusted origins. No arbitrary metadata fetch path was established from the reviewed configuration.
- Cookie-only MCP is refused, existing business/consent Origin checks remain, and unknown protocol routes have non-HTML failures.
- Structured log fields are narrowly allowlisted, invocation logs are disabled, and sampling is deliberately configured in the unchanged Worker config.
- Windows CLI entrypoint comparisons are corrected. The release checker rejects missing/placeholder structural evidence and matches local migration hashes. The pre-write checklist and post-write closeout are honestly separated; the checker performs no cutover.
- The controller separately inspected the reported desktop/mobile screenshots and confirmed their stated rendering. This reviewer inspected the browser test logic and did not rerun the reported browser suites.

## Focused reviewer verification

Only the three named revocation/replay doubts were exercised against synthetic native Worker/D1 state. Retained reproducer:

`.superpowers/sdd/softr-cloudflare-migration-plan-2026-09-11/task-7-repro.test.ts`

Observed command:

`pnpm exec vitest run .superpowers/sdd/softr-cloudflare-migration-plan-2026-09-11/task-7-repro.test.ts --config .superpowers/sdd/softr-cloudflare-migration-plan-2026-09-11/task-7-repro.config.ts`

Result: **3 assertions failed in the expected defect/policy probes**, one file, 18.81 seconds. The bounded log is `task-7-repro.log`; safe outcome lines are 10, 23 and 32. Earlier harness/output-capture attempts did not yield retained assertion evidence and are not credited as tests. No reported broad suite was deliberately rerun, no localhost:8787 process was touched, and no real email/provider/cloud/private-archive operation occurred.

Unchanged files were opened only for named shared-interface risks: the diagnostics opener's mutation behavior, environment release switches/observability defaults, OAuth login/signup continuation, and diagnostics columns. Installed library source was consulted for active-token, consent deletion, signed continuation, refresh reuse, metadata-fetch restrictions and legacy transport contracts.

## Items that cannot be verified from this diff

Exact deployed resources/version IDs, clean committed candidate, production migration ledger, final frozen-source import and attachment reconciliation, real mail delivery, provider evaluation, deployed restore/rollback, routing, accepted-write boundary and real deployed Codex/client acceptance remain external gates. The report correctly states that no production endpoint exists and defaults stay off. Those absences are not the reason for this review's rejection; the seven local findings above are.

