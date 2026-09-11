# Phase 7 fix round 1 scoped re-review

Date: September 11, 2026.

**Specification verdict: issues found; R1, R5, and R7 remain open.**

**Code-quality verdict: needs fixes.**

R2, R3, R4, and R6 are closed for local acceptance. The remaining blockers below are local defects or unmet original requirements, not deployment or staging preparation requirements.

## Review boundary and evidence

Reviewed the original R1–R7 findings, fix brief, fix report, corrected Phase 7 report, manifest, and frozen 27-file patch. Base tree: `2f0b58c6192bb2254fdd55eb26a015ea33d1aa83`; candidate tree: `4cf886f5901bed4c2e581b35b4d949c384cfb4e9`. Independently verified the 163630-byte patch SHA-256: `e28ae5d24d1fc3d68483543d68851567b462f9ac696a81c8b60011604dbaa9ff`. The first patch output was truncated; only the missing sections were subsequently recovered, without restarting the audit.

The controller verified packaging against a separate index, unchanged real index tree `64f93b5d350664320a8c1f3d0c977f337b1cd7d4`, unchanged HEAD `95799ea261871402be2598f5aea3d4109f6065f2`, and unchanged SQL 0001–0006. A final read-only hash comparison found zero mismatches across all 27 frozen source files. This reviewer made no source, original test, index, or Git mutations. Only this report and a bounded ignored synthetic reproducer/config were written. No private archive, real mail/provider, cloud, deployment, localhost:8787, or agent operation occurred.

## Remaining actionable findings

### R1 — P1: shared verification JSON parsing breaks password reset and can prevent disconnect

**Locations:** `packages/data/migrations/0007_mcp.sql:82` and `:101`; `workers/app/src/index.ts:313`.

Both new `auth_verification` INSERT triggers evaluate `json_extract(NEW.value,'$.type')` without safely handling non-JSON values. Installed Better Auth stores a password-reset verification's value as the plain user ID (`node_modules/better-auth/dist/api/routes/password.mjs:75–78`). A normal reset request for an existing account therefore aborts before mail delivery with SQLite `malformed JSON`. An absent account skips that insert, so the regression also breaks the existing non-enumerating response contract.

The disconnect DELETE has the same unconditional JSON extraction across the shared table. A still-pending plain-value reset record created before migration 0007 causes the disconnect batch to fail, leaving the connected grant usable instead of revoked.

**Independent synthetic evidence:** applying the exact migrations to in-memory SQLite and inserting the maintained provider's plain reset-value shape fails with `malformed JSON`. Separately, inserting that shape before 0007, applying 0007, and executing the exact disconnect DELETE also fails with `malformed JSON`.

**Controller native evidence:** the four affected existing non-MCP native files passed 29/31 assertions in 27.80 s. The two unchanged reset tests at `tests/integration/security.test.ts:132` and `:170` fail with 500 instead of 202 and D1 `malformed JSON`. This was communicated by the controller and was not rerun here.

Make every OAuth-specific JSON inspection safe for the shared table's non-JSON lifecycle values, including both trigger predicates and disconnect filtering. Add focused reset/ordinary-verification and pre-existing-reset-plus-disconnect regression coverage. Do not rely on WHERE clause predicate ordering to prevent malformed JSON evaluation.

The intended epoch design itself materially repairs the original issuance gaps: exact user/client/session/challenge/redirect/resource/scope/state intent matching gates code insertion; code-hash bindings survive provider verification consumption; token INSERT guards and resource validation require the current active epoch; disconnect removes all matching consent records; re-consent advances inactive epochs. Tests at `tests/integration/mcp.test.ts:430` and `:478` model pending-code redemption, consumed-code/late-token persistence, prior-consent/late-code persistence, and old-intent insertion after re-consent. R1 nevertheless cannot close while the shared lifecycle and disconnect regression above remains.

### R5 — P2: read-only SQLite opening still changes original WAL state

**Location:** `scripts/ops/local-inspection.ts:38`.

`new DatabaseSync(file, { readOnly: true })` prevents application SQL writes but does not ensure filesystem immutability. Opening a recognized WAL-mode database whose connection was cleanly closed can create `-wal` and `-shm` files in the original store.

**Independent synthetic evidence:** created an external temporary recognized store with a D1-path SQLite file, a `local_migrations` table, and `PRAGMA journal_mode=WAL`; closed its creating connection. Before inspection the D1 directory contained only `synthetic.sqlite`. After the actual `openLocalInspection`, one SELECT, and `dispose`, it contained `synthetic.sqlite`, `synthetic.sqlite-wal`, and `synthetic.sqlite-shm`. No historical store was opened. Retained disposable fixture: `C:/Users/htper/AppData/Local/Temp/phase7-fix1-inspect-58CEyb`.

The delivered pending-store test (`tests/unit/ops.test.mjs:91`) removes a ledger row from a fully migrated Miniflare fixture, which does not represent this closed-store file lifecycle; its snapshot helper also deliberately omits `-shm` (`:79`).

Use an inspection strategy that cannot create or alter files in the original store and correctly handles any existing WAL content. Cover a closed WAL-mode recognized store and a genuinely pending schema, comparing the full original file set and durable DB/WAL contents before and after. The original migration-application defect is fixed, and nonexistent stores are refused, but the stronger required immutability contract remains unmet.

### R7 — P2: maintained SDK schema refusals still have no rejection event

**Location:** `workers/app/src/index.ts:652–653`.

The new pre-callback rejection logger runs only when the request contains `Mcp-Name`. The supported installed SDK 1.30 transport does not send that newer protocol header. Invalid tool arguments are rejected by the server schema before the registered callback, so neither this conditional logger nor the callback logger emits `mcp_tool_rejected`. Operations still sees only HTTP completion for these refusals.

**Independent native evidence:** a real locally issued token and the installed SDK completed initialization. `client.callTool` for `save_job` with an unknown input field was rejected as intended, but the only captured event was `mcp_call_completed`. The focused assertion requiring a rejection event failed. Reproducer: `.superpowers/sdd/softr-cloudflare-migration-plan-2026-09-11/task-7-fix1-repro.test.ts:126–148`, with its sibling config.

Observe pre-callback refusals for every supported transport revision using validated, bounded protocol information; do not require the newer optional header for the legacy transport. Preserve the finite reason and tool allowlists and exclude raw arguments/tokens. Add the demonstrated SDK schema-refusal assertion.

### R7 — P2: dispatch error reasons remain collapsed into mere presence

**Location:** `scripts/ops/diagnostics.ts:85`.

The original finding required dispatch error reasons. The new aggregate transforms every non-null `last_error` into `present`, so it still cannot distinguish an uncertain dispatch from an exhausted retry lease. Both are existing finite application codes: `dispatch_unconfirmed` and `dispatch_lease_exhausted` are written by `workers/jobs/src/dispatcher.ts:67,122` and `workers/jobs/src/generation-dispatcher.ts:40,95`.

Aggregate a finite allowlisted reason, with a bounded fallback for unexpected values, rather than exposing raw stored text or discarding the reason. Verify both distinct synthetic conditions. Backlog, generation token usage, and repository-versus-ledger drift were added correctly; they do not replace this original missing signal.

## Per-finding closure

| Finding | Local status | Evidence and limits |
| --- | --- | --- |
| R1 | **Open** | The epoch/code-binding/resource boundary addresses both named issuance orders and later re-consent. The new shared-table JSON regression breaks reset and can abort revocation; see above. |
| R2 | **Closed** | `workers/app/src/index.ts:116–117` blocks both provider delete/update-consent mutations. The remaining Account route retains authenticated owner lookup and the existing Origin middleware. `tests/integration/mcp.test.ts:605` asserts both alternate routes return 404 while the real consent and access remain visible/usable. |
| R3 | **Closed** | `apps/web/src/routes/auth.tsx` retains the exact signed query through sign-in, signup links, verification and resend callback URLs; sign-in passes `oauth_query` and follows only an HTTP(S) provider response. The installed provider remains responsible for signature/continuation validation. Native fresh-signup test `:869` asserts synthetic verification delivery, exact callback, sign-in and signed consent continuation; the updated browser starts authorization signed out. R1's reset regression is separately blocking. |
| R4 | **Closed** | Tool registration at `workers/app/src/mcp/tools.ts:68–85` applies independent MCP write, generation and review gates; ordinary write/generation service gates remain. Base/staging/production config, generated bindings, environment type, local examples, readiness, release evidence and CI controls contain default-off flags. Actual-transport listing assertions at `tests/integration/mcp.test.ts:1241` demonstrate each capability's exclusion while unrelated tools remain; excluded tools are not registered for dispatch. |
| R5 | **Open** | Diagnostics no longer uses the mutating migration opener and refuses absent/unrecognized stores. The real SQLite opening path still creates original-store WAL/shared-memory files. |
| R6 | **Closed** | `workers/app/src/auth.ts:130` explicitly selects zero reuse grace. Test `:728` submits the old refresh credential, asserts 400, then verifies the rotated child's family is invalidated. Tests `:760,806,835,855` exercise real stored credential expiry, cross-client misuse, session/current verified-user loss and signed-query tampering. Test `:1122` persists an owned queued generation request; `:1181` uses installed SDK initialize/listTools. The new pending-code test actually reuses the original client. These claims are supported by assertions, not just counts. |
| R7 | **Open** | Backlog state/action, generation token totals and migration drift now exist; callback rejection logging is finite/redacted. SDK pre-callback rejection logging and dispatch-reason aggregation still have the gaps above. |

The controller's secret-pattern scan hit in the MCP refusal test is a deliberate invalid-token redaction sentinel, not a credential; no material scanner finding arose from it.

## Focused verification and report accuracy

No passing broad suite was rerun by this reviewer. Only the two SQLite lifecycle doubts and one installed-SDK rejection doubt were exercised against synthetic state. The SDK command was:

`pnpm exec vitest run .superpowers/sdd/softr-cloudflare-migration-plan-2026-09-11/task-7-fix1-repro.test.ts --config .superpowers/sdd/softr-cloudflare-migration-plan-2026-09-11/task-7-fix1-repro.config.ts`

Result: **1 test failed at the expected missing-event assertion**, 13.74 s. A preceding reproducer setup attempt had a missing closing brace and ran no tests; it is not counted as defect evidence. Installed SDK sourcemap and form-body warnings did not cause the assertion failure.

The implementation reports are improved about strict refresh policy, installed-SDK feasibility, independent flags, and external acceptance. Their blanket R1–R7 completion and read-only/rejection-observability statements must be narrowed until these remaining local issues are fixed. The 41/41 MCP and 14/14 ops implementation counts do not establish safety for the missing shared-reset, closed-WAL, or legacy-SDK refusal cases demonstrated here.

Local acceptance remains separate from deployed acceptance. This re-review does not request more ancillary staging preparation and does not start Phase 8.

