# Phase 7 scoped fix round 2 report

Date: September 11, 2026.

## Status and boundary

The four follow-up defects under R1, R5 and R7 are corrected locally and the candidate is ready for scoped independent re-review. R2, R3, R4 and R6 were already closed and were preserved. The grant-epoch design and reviewer evidence were not changed.

This is local acceptance evidence only. No staging or production resource was provisioned or changed; no deployment, mail, provider, private archive, localhost:8787, Git index, commit, push or delegation operation occurred. Staging preparation remains stopped and every release control remains off by default.

Fix-round base tree: `4cf886f5901bed4c2e581b35b4d949c384cfb4e9`. The real Phase 1-6 index remains `64f93b5d350664320a8c1f3d0c977f337b1cd7d4`, and SQL migrations 0001-0006 have no worktree diff.

## Corrections

### R1: shared verification values

Both `auth_verification` INSERT triggers now evaluate OAuth JSON fields only inside `CASE WHEN json_valid(...)`. Account disconnect uses the same safe boundary before filtering authorization-code values. Plain password-reset values remain untouched and cannot abort either reset insertion or the disconnect transaction.

The unchanged existing reset assertions first reproduced the defect: 2/2 failed with HTTP 500 instead of 202 and D1 `malformed JSON` (12.75 s). After the correction, the same focused command passed 2/2. A new maintained integration case keeps a plain reset row pending during disconnect and proves the grant is revoked, the token immediately fails, and the reset row remains.

### R5: immutable local diagnostics

Diagnostics no longer opens any SQLite file in the original recognized store. It locates candidates without SQLite, copies each candidate's main database and any existing WAL/SHM sidecars into an operating-system temporary directory, recognizes and queries the copy read-only, then closes and removes the copy.

The regression creates a genuine Phase 1-6 schema in WAL mode, checkpoints it, commits a source-observation row only to a new WAL, captures main/WAL/SHM while the writer is open, and restores that snapshot only after the child process has exited. Diagnostics reads the WAL-only row, reports `0007_mcp.sql` as the sole missing migration, and a SHA-256 snapshot of every original file including SHM is identical before and after. Missing stores continue to fail closed.

### R7: SDK schema-refusal observability

The maintained SDK 1.30 does not send `Mcp-Name`. The Worker therefore accepts either that header or a body-limited cloned JSON-RPC `tools/call` envelope as protocol metadata and retains only a name present in the finite tool allowlist. It discards the request id, arguments, unknown tool names, tokens and malformed payloads. A rejected MCP response that occurs before a tool callback now emits `mcp_tool_rejected` with the allowlisted tool and finite `invalid_request` reason.

The retained reviewer reproducer was red before this correction: its real installed-SDK unknown-field call emitted only `mcp_call_completed`, so 1/1 failed at the missing rejection-event assertion (14.44 s). The same unchanged reproducer now passes 1/1. The maintained MCP test also makes the real SDK schema refusal, requires `mcp_tool_rejected`, and proves an argument sentinel is absent from serialized logs.

### R7: finite dispatch diagnostics

Outbox diagnostics now distinguish `dispatch_unconfirmed`, `dispatch_lease_exhausted`, `none`, and `other`. The query never returns raw `last_error`. A real in-memory SQLite aggregate test covers all four values and proves an unexpected stored sentinel is absent from the report.

## Changed and new paths

These are the complete round 2 changes relative to `4cf886f5901bed4c2e581b35b4d949c384cfb4e9`:

1. `README.md`
2. `docs/migration/release-evidence.md`
3. `packages/data/migrations/0007_mcp.sql`
4. `scripts/ops/diagnostics.ts`
5. `scripts/ops/local-inspection.ts`
6. `tests/integration/mcp.test.ts`
7. `tests/unit/ops.test.mjs`
8. `workers/app/src/index.ts`
9. `.superpowers/sdd/softr-cloudflare-migration-plan-2026-09-11/task-7-report.md`
10. `.superpowers/sdd/softr-cloudflare-migration-plan-2026-09-11/task-7-fix2-report.md` (new)

Reviewer files and reproducers are unchanged.

## Verification evidence

Focused red/green and regression commands:

- `pnpm exec vitest run tests/integration/security.test.ts -t "reset transport|restored transport"`: RED 0/2, then GREEN 2/2 with 15 skipped in 12.50 s.
- `pnpm exec vitest run tests/integration/mcp.test.ts -t "pending plain-value"`: 1/1 passed with 41 skipped in 12.42 s.
- `node --test --test-name-pattern="diagnostics inspects|diagnostics allowlists" tests/unit/ops.test.mjs`: 2/2 passed in 0.77 s.
- `pnpm exec vitest run .superpowers/sdd/softr-cloudflare-migration-plan-2026-09-11/task-7-fix1-repro.test.ts --config .superpowers/sdd/softr-cloudflare-migration-plan-2026-09-11/task-7-fix1-repro.config.ts`: RED 0/1, then GREEN 1/1 in 13.32 s.
- `pnpm exec vitest run tests/integration/mcp.test.ts -t "installed MCP SDK"`: 1/1 passed with 41 skipped in 12.84 s.

Fresh affected gates after code formatting:

- `pnpm exec vitest run tests/integration/security.test.ts`: 17/17 passed in 23.11 s.
- `pnpm exec vitest run tests/integration/mcp.test.ts`: 42/42 passed in 38.96 s.
- `node --test tests/unit/ops.test.mjs`: 15/15 passed in 2.61 s.
- `pnpm typecheck`: passed.
- `pnpm typecheck:migration`: passed.
- `pnpm lint`: passed.
- `pnpm exec prettier --check scripts/ops/diagnostics.ts scripts/ops/local-inspection.ts tests/integration/mcp.test.ts tests/unit/ops.test.mjs workers/app/src/index.ts README.md docs/migration/release-evidence.md .superpowers/sdd/softr-cloudflare-migration-plan-2026-09-11/task-7-report.md .superpowers/sdd/softr-cloudflare-migration-plan-2026-09-11/task-7-fix2-report.md`: passed.

The installed SDK emits known missing-sourcemap and form-body warnings during its passing tests. They do not change the assertions or expose request arguments in the captured structured events.

## Remaining external limitations

No application endpoint is deployed. Production and exact deployed-staging evidence remain unavailable: Worker versions and bindings, migration ledger, mail delivery, provider behavior/cost, private R2 isolation, restore/rollback, DNS/routes, accepted-write boundaries, and a real deployed Codex/client OAuth session. Independent scoped round 2 review is the next local gate; this report does not authorize staging or production work.
