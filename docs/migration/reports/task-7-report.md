# Task 7 report: user-scoped OAuth MCP and operational readiness

## Status

The Phase 7 local implementation and three scoped R1-R7 fix rounds are complete and independently accepted. `task-7-fix3-review.md` records specification PASS, quality PASS and closure of every original finding R1–R7 at candidate tree `2bce5e5367f7e28ae3f8263910f23e12968ff440`. This is not production readiness or deployment acceptance. All release controls default off. During this Phase 7 implementation, no deployment, cloud mutation, private-source access, real email, provider call, staging action, commit, push, or localhost:8787 change occurred. Staging preparation remains stopped under the latest user direction.

Reviewed Phase 1-6 index tree: `64f93b5d350664320a8c1f3d0c977f337b1cd7d4`. Frozen pre-fix Phase 7 tree: `2f0b58c6192bb2254fdd55eb26a015ea33d1aa83`. Migrations 0001-0006 remain outside this fix round; Phase 7 changes only additive migration `0007_mcp.sql`.

The original fixes and evidence are in `task-7-fix1-report.md`; the four follow-up corrections are in `task-7-fix2-report.md`; and the final R5 copy-consistency correction, exact round 3 paths, and fresh operations evidence are in `task-7-fix3-report.md`. Independent reviews and retained reproducers remain unchanged.

## Delivered behavior

### OAuth and revocation authority

Better Auth 1.7.4, `@better-auth/mcp` 1.7.4, and `@better-auth/oauth-provider` 1.7.4 provide authorization code with S256 PKCE, DCR, signed login/consent continuation, opaque tokens, and maintained active-token validation. `@modelcontextprotocol/server` 2.0.0 provides Streamable HTTP MCP.

Each authorization execution records a server-derived user/client/session grant epoch and exact continuation fields before provider issuance. D1 triggers require that exact active epoch when a code is persisted, bind its maintained SHA-256 identifier to the epoch, and require the same current epoch when access or refresh rows are persisted. Resource access joins the opaque token through its code binding to the current active epoch.

Disconnect removes outstanding codes, access tokens, refresh tokens, and all matching consent records in one D1 transaction and deactivates the epoch. This closes both confirmed provider gaps:

- code verification consumed before disconnect, then token persistence after disconnect: token insertion fails;
- consent read before disconnect, then code persistence after disconnect: code insertion fails.

A later explicit consent advances the epoch. Old codes, intents, access tokens, and refresh tokens cannot inherit the new grant. Provider delete/update-consent mutation routes are blocked.

The shared Better Auth verification table also contains plain user IDs during password reset. OAuth trigger predicates and disconnect filtering first establish valid JSON inside a `CASE`, so these lifecycle values neither abort reset delivery nor prevent revocation.

Provider and application checks share one SHA-256/base64url token hash. Refresh rotation sets `refreshTokenReuseInterval: 0`: any reuse is replay and invalidates the family. This strict policy can require reconnect after an ambiguous network retry.

### Signed-out continuation

Authorization started signed out retains the provider's exact signed query through login, login/signup switching, signup verification callback, resend, and sign-in. The app passes `oauth_query` to the maintained provider hook and follows only an HTTP(S) provider response URL. The provider verifies the continuation before session creation and authorization.

Native coverage exercises fresh signup, synthetic verification delivery, callback to the exact signed login URL, sign-in, and consent continuation. Browser coverage starts authorization signed out and continues through deny, allow, MCP access, Account disconnect, and same-client re-consent.

### MCP authorization and release controls

The 18 tools use strict schemas, owner-scoped services, immutable actor identity, bounded pagination, idempotency where applicable, and optimistic revisions. No generic SQL/CRUD, arbitrary HTTP, source administration, application administration, or identity/model/provider override is exposed.

Scopes are `app:read`, `app:write`, `drafts:generate`, `drafts:review`, and `offline_access`. Release controls are separate:

- `MCP_ENABLED`: protocol surface;
- `MCP_WRITES_ENABLED`: MCP mutations;
- `MCP_GENERATION_ENABLED`: generation requests;
- `MCP_REVIEW_ENABLED`: approval.

Ordinary `WRITES_ENABLED` and `GENERATION_ENABLED` remain required. Every MCP flag defaults false in base, staging, production, local example, generated types, and readiness output. CI supplies explicit synthetic flags only to the isolated MCP browser job.

### Operations

`scripts/ops/diagnostics.ts` requires an existing recognized rehearsal store. It hashes the existing D1 SQLite file and any WAL/SHM sidecars, copies them into disposable storage, then accepts the snapshot only when the source hashes remain stable and every captured hash matches. A checkpoint or writer interleaving is retried at most three times and then fails closed with an instruction to stop writers. SQLite opens only the accepted copy. Diagnostics never invokes migration setup, creates or changes the original store, rewrites config, or applies schema. Fixed aggregates cover source age; ingestion runs and backlog state/action; outbox kind/state/allowlisted dispatch reason/age/attempts; generation request/attempt state and token usage; repository-versus-ledger drift; attachments; reviews; and OAuth grants.

Structured logs use finite event/reason sets. Authentication refusals and tool callback/protocol/schema refusals emit redacted events. For SDK 1.30 requests without `Mcp-Name`, the Worker reads a body-limited cloned JSON-RPC envelope and retains only an allowlisted tool name; raw arguments, tokens, continuations, record values, provider output, and exceptions never enter the event.

Release evidence has a human pre-write checklist and separate post-write closeout checker. The checker requires observed `firstAcceptedTargetWriteAt`; it is not a preflight gate and authorizes nothing.

## Current local verification

- Round 2 `pnpm exec vitest run tests/integration/security.test.ts`: 17/17 passed in 23.11 s.
- Round 2 `pnpm exec vitest run tests/integration/mcp.test.ts`: 42/42 passed in 38.96 s.
- Round 2 retained installed-SDK reviewer reproducer: 1/1 passed in 13.32 s.
- Round 3 `node --test tests/unit/ops.test.mjs`: 16/16 passed in 2.32 s.
- Round 3 `pnpm typecheck:migration`: passed.
- Round 3 focused operator/test Prettier check: passed.
- Round 2 `pnpm typecheck` and `pnpm lint`: passed; round 3 did not change their covered application source.
- Round 1 isolated browser acceptance passed 1/1 for signed-out MCP on port 8893 and 12/12 for core/review flows on port 8894.
- Round 1 app-Worker and jobs-Worker dry builds both passed. Round 2 did not rerun browser or dry-build checks because its scoped changes were covered by the affected native gates above.

The MCP integration file covers both issuance/disconnect races, old intent after re-consent, provider consent-route bypass, plain reset values during disconnect, strict refresh replay/family invalidation, code/access/refresh expiry, cross-client code/refresh misuse, session and verified-user invalidation, tampered continuation, actual queued generation, capability flags over transport, same-client reconnect, redacted tool rejection, and an installed SDK 1.30 initialize/list-tools/schema-refusal flow.

## External acceptance still required

No application endpoint is deployed. Production and exact deployed staging evidence remain unverified: Worker versions/resources, migration ledger, mail delivery, provider evaluation/cost, private R2 isolation, restore/rollback, DNS/routes, accepted-write boundary, and a real deployed Codex/client OAuth session. All flags remain off. Phase 7 local acceptance is complete; no additional staging preparation or Phase 8 work has been started.
