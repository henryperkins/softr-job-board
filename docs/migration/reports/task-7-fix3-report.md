# Phase 7 scoped fix round 3 report

Date: September 11, 2026.

## Status and boundary

The remaining R5 database-copy consistency defect is corrected locally and ready for final scoped review. R1, R2, R3, R4, R6 and both R7 defects were already closed and were not changed or retested. The original-store immutability guarantee remains in place.

Fix-round base tree: `ca3be2726ea1937d0312527792968e9c95c47a6e`. The real index remains `64f93b5d350664320a8c1f3d0c977f337b1cd7d4`; HEAD remains `95799ea261871402be2598f5aea3d4109f6065f2`; and migrations 0001-0006 remain unchanged. No cloud, staging, deployment, mail/provider, private historical store, localhost:8787, Git publication, cleanup or delegation operation occurred.

## Correction and guarantee

The inspector never opens a source database with SQLite. For each discovered main database it now:

1. hashes the main file and the current presence/content of its WAL and SHM sidecars;
2. copies exactly that observed file set into a disposable attempt directory;
3. hashes the source set again and hashes the captured set;
4. accepts the snapshot only when the source was byte-identical across the capture and every copied hash equals the source hash;
5. removes an unstable attempt and retries, with a fixed maximum of three attempts.

If all three attempts are unstable, inspection removes its scratch data and fails with `Local migration store changed during 3 snapshot attempts. Stop its writers and retry.` It cannot return a successful empty or stale report for a detected writer/checkpoint interleaving. A stable WAL-only committed row remains visible because the accepted main/WAL/SHM set is copied and opened together.

## Red/green evidence

The new deterministic test keeps an independent source connection open with one committed row only in WAL. Its injected filesystem wrapper performs the real main-file copy and then checkpoints the source before the normal WAL copy.

- RED, before stability detection: `node --test --test-name-pattern="checkpointed between copies" tests/unit/ops.test.mjs` failed 0/1 because the source had 1 committed row and inspection returned 0 (0.31 s).
- GREEN, after stability detection: the same command passed 1/1 (0.35 s). The first capture was rejected; the bounded retry captured the checkpointed main database and inspection returned the committed row.

The existing closed Phase 1-6/WAL-only fixture continues to compare the complete original file set including SHM before and after inspection. The full operations gate therefore covers both stable WAL observation and the checkpoint race.

## Changed and new paths

These are the complete round 3 changes relative to `ca3be2726ea1937d0312527792968e9c95c47a6e`:

1. `README.md`
2. `docs/migration/release-evidence.md`
3. `scripts/ops/local-inspection.ts`
4. `tests/unit/ops.test.mjs`
5. `.superpowers/sdd/softr-cloudflare-migration-plan-2026-09-11/task-7-report.md`
6. `.superpowers/sdd/softr-cloudflare-migration-plan-2026-09-11/task-7-fix3-report.md` (new)

Reviewer reports and reproducers are unchanged.

## Focused verification

- `node --test tests/unit/ops.test.mjs`: 16/16 passed in 2.32 s.
- `pnpm typecheck:migration`: passed.
- `pnpm exec prettier --check scripts/ops/local-inspection.ts tests/unit/ops.test.mjs README.md docs/migration/release-evidence.md .superpowers/sdd/softr-cloudflare-migration-plan-2026-09-11/task-7-report.md .superpowers/sdd/softr-cloudflare-migration-plan-2026-09-11/task-7-fix3-report.md`: passed.

The repository has no configured ESLint target for `scripts/ops` or Node MJS tests. `tsconfig.migration.json` supplies the strict operator TypeScript gate. Per the round 3 brief, security, MCP, browser, Worker builds, dependency audits and staging work were not repeated.

## Remaining external limitations

No application endpoint is deployed. Production and exact deployed-staging evidence remains unavailable: Worker versions and bindings, migration ledger, mail delivery, provider behavior/cost, private R2 isolation, restore/rollback, DNS/routes, accepted-write boundaries, and a real deployed Codex/client OAuth session. Final independent R5 review is the remaining local Phase 7 gate; this report authorizes no staging or production work.
