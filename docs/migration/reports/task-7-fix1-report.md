# Task 7 scoped fix round 1 report

Date: September 11, 2026.

## Outcome

R1-R7 are implemented locally against frozen Phase 7 tree `2f0b58c6192bb2254fdd55eb26a015ea33d1aa83` and are ready for scoped independent re-review. This report does not claim production readiness. No deployment, cloud mutation, private archive access, mail/provider call, staging, commit, push, or localhost:8787 operation occurred. SQL migrations 0001-0006 were not changed.

The independent review, its reproducer, and its log were preserved unchanged.

## Finding resolution

### R1: durable disconnect across provider issuance races

Added a server-derived per-user/client grant epoch, exact user/client/session/continuation authorization intents, maintained-hash code bindings, and D1 insertion guards.

- The application captures an expected epoch before provider continuation.
- Consent insert activates the first epoch or advances an inactive epoch; consent removal deactivates it.
- Authorization-code persistence requires an unexpired exact intent at the current active epoch.
- Access and refresh persistence require their code binding to the same current epoch.
- Resource use joins the opaque token through its code binding to that current epoch.
- Disconnect transactionally deletes pending codes, access tokens, refresh tokens, and every matching consent.
- Later consent advances the epoch; an older intent or credential cannot inherit it.

Deterministic coverage models both installed-provider orders: consumed verification before token persistence, and consent read before late code persistence. It also attempts the old late insert after re-consent.

### R2: consent-management bypass

Blocked the provider's `/auth/oauth2/delete-consent` and `/auth/oauth2/update-consent` mutation routes. The owner- and Origin-checked Account endpoint remains the sole exposed disconnect mutation and performs complete revocation.

### R3: signed-out login and fresh signup continuation

The web app retains the exact signed OAuth query across login/signup links, signup verification and resend callback URLs, and sign-in. It sends `oauth_query` to the maintained provider hook and accepts only an HTTP(S) provider redirect response.

Native coverage uses a synthetic email binding to complete fresh signup, verification, exact callback, sign-in, and consent continuation. Browser coverage begins authorization signed out before completing denial, consent, MCP use, disconnect, and same-client re-consent.

### R4: independent MCP capability gates

Added `MCP_WRITES_ENABLED`, `MCP_GENERATION_ENABLED`, and `MCP_REVIEW_ENABLED` in addition to `MCP_ENABLED`. All default false in base, staging, production, local examples, generated binding types, and session readiness. The isolated CI MCP browser command passes its explicit flags and port. Actual-transport assertions verify each disabled capability is absent while unrelated allowed tools remain.

### R5: inspection-only diagnostics

Added an opener that requires an existing recognized rehearsal directory and existing D1 file, then uses Node SQLite read-only mode. Diagnostics no longer calls `openLocalMigration`, writes config, creates a destination, or applies migrations. Synthetic subprocess tests prove a ledger with 0007 pending remains unchanged and a nonexistent destination remains absent.

### R6: security and transport coverage

Set `refreshTokenReuseInterval: 0` explicitly. Immediate old-token reuse returns 400 and invalidates the rotated child. Added real stored credential expiry, cross-client code/refresh misuse, current session/user invalidation, tampered signed continuation, successful queued generation through MCP, same-client re-consent, and installed `@modelcontextprotocol/sdk` 1.30 initialize/list-tools coverage.

The strict zero-second retry policy is deliberate. A client must retain the newest successful refresh response; after an ambiguous retry/replay it may need to reconnect.

### R7: truthful operational signals

Diagnostics now includes fixed bounded aggregates for ingestion backlog state/action, outbox kind/state/error presence/age/attempts, generation usage, and repository-versus-ledger migration drift. Tool callback failures and pre-callback protocol/schema refusals emit `mcp_tool_rejected` with finite reasons and allowlisted tool/client fields. Tests confirm hostile input and tokens do not enter logs.

## Changed repository paths versus frozen Phase 7

1. `.github/workflows/checks.yml`
2. `README.md`
3. `apps/web/src/api.ts`
4. `apps/web/src/routes/auth.tsx`
5. `docs/connect-ai-assistant.md`
6. `docs/migration/parity-matrix.md`
7. `docs/migration/release-evidence-post-write.template.json`
8. `docs/migration/release-evidence.md`
9. `packages/data/migrations/0007_mcp.sql`
10. `scripts/ops/diagnostics.ts`
11. `scripts/ops/local-inspection.ts` (new)
12. `scripts/ops/release-evidence.ts`
13. `tests/e2e/mcp.spec.ts`
14. `tests/e2e/preview.mjs`
15. `tests/integration/mcp.test.ts`
16. `tests/unit/ops.test.mjs`
17. `vitest.config.ts`
18. `workers/app/.dev.vars.example`
19. `workers/app/src/auth.ts`
20. `workers/app/src/env.ts`
21. `workers/app/src/index.ts`
22. `workers/app/src/mcp/resource-server.ts`
23. `workers/app/src/mcp/tools.ts`
24. `workers/app/src/oauth-grants.ts` (new)
25. `workers/app/src/observability.ts`
26. `workers/app/worker-configuration.d.ts`
27. `workers/app/wrangler.jsonc`

Reporting artifact updates: `task-7-report.md` and this `task-7-fix1-report.md`.

## Red/green evidence

- R1 provider sequence RED: pending code exchange returned 200 instead of 400; provider consent delete returned 200 instead of 404. Two tests failed, 30 skipped, 42.78 s.
- R1 epoch boundary RED: `oauthAuthorizationCodeGrant` did not exist. One test failed, 32 skipped, 29.39 s.
- R1/R2 GREEN: focused command passed 3/3, 30 skipped, 12.48 s.
- R3 browser RED on isolated port 8891: signed login retained the provider query, but the signup link received `/sign-up` instead of the exact signed query. One test failed in 5.7 s.
- R3 browser GREEN on isolated port 8892: one test passed in 20.5 s.
- R3 fresh verified-signup native GREEN: one test passed, 40 skipped, 11.04 s.
- R6 first focused run: seven tests passed; queued generation alone failed because the synthetic fixture had no `job_versions` prerequisite. After adding that real relationship, the queued generation test passed, 39 skipped, 11.54 s.
- R5 first synthetic inspection run exposed the test's already-existing-directory setup mismatch; the next exposed transient SQLite shared-memory lock bytes. The production opener was narrowed to the recognized D1 file and the assertion compares durable DB/WAL/config/marker evidence. Focused inspection then passed.
- Consolidated MCP integration: `pnpm exec vitest run tests/integration/mcp.test.ts` passed 41/41 in 34.92 s.
- Operations: `node --test tests/unit/ops.test.mjs` passed 14/14 in 6.37 s, including no checksum mismatches for unchanged applied migrations.
- Isolated final MCP browser: port 8893 with all synthetic MCP flags, 1/1 passed in 19.3 s.
- Affected core/review browser: isolated port 8894, 12/12 passed in 37.9 s.
- `pnpm typecheck`, `pnpm typecheck:web`, and `pnpm typecheck:migration`: passed.
- `pnpm lint`: passed.
- `pnpm build`: web build plus both Worker dry runs passed. The app dry run displayed all four MCP flags false.
- Focused Prettier check across supported changed code/config/docs/report files: passed.

The expected Miniflare warnings about reading form-urlencoded bodies as text and installed SDK missing-source sourcemap warnings did not fail assertions.

## Remaining external gates

Independent scoped re-review is still required. No deployed endpoint, Worker version, D1/R2 resource, mail delivery, provider evaluation, restoration, routing, accepted-write boundary, or real deployed Codex OAuth session was verified. Those remain later release gates and must not be inferred from local PASS results.
