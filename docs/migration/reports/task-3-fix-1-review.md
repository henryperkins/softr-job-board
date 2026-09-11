### Spec Compliance

- ✅ All three original findings are addressed: attachment source hashes cover persisted core attributes (`scripts/migration/map-records.ts:179`); immutable source history is separate from current pointers (`packages/data/migrations/0004_migration_history.sql:2`); authoritative exports must satisfy the checked field-ID/name/type and source identity contract before writes (`scripts/migration/validate-export.ts:124`, `scripts/migration/validate-export.ts:174`).
- ❌ One direct interaction introduced by immutable manifest membership still breaks archive replay (`scripts/migration/import-d1.ts:98`, `scripts/migration/reconcile.ts:172`).
- ⚠️ The appended report records 10 passing focused tests, passing migration TypeScript, and successful additive local rehearsal. No private aggregate evidence or production release gate was independently rechecked.

### Strengths

- The local D1/R2 regression now updates a parent timestamp while keeping attachment bytes unchanged and asserts both the stored timestamp and successful reconciliation (`tests/unit/rehearsal.test.mjs:87`).
- Source history prevents both updates and deletions and retains earlier values that do not appear in application version tables (`packages/data/migrations/0004_migration_history.sql:17`, `tests/unit/import.test.mjs:108`).
- Schema validation blocks stable-ID display-name changes before existing target values can be cleared (`tests/unit/import.test.mjs:66`).

### Issues

#### Critical (Must Fix)

- None.

#### Important (Should Fix)

1. **P2 — Replaying an earlier archive leaves immutable target hashes inconsistent.** `scripts/migration/import-d1.ts:98` inserts membership with `ON CONFLICT DO NOTHING`, keyed by the source-content-derived manifest and source identity (`packages/data/migrations/0004_migration_history.sql:12`). Reconciliation now demands that this immutable membership target hash equal the mutable current snapshot target hash (`scripts/migration/reconcile.ts:172`). Sequence: import archive A; import changed archive B; replay A. The existing importer reuses A's manifest ID but updates roots with new import timestamps/revisions and stores those new hashes in current snapshots. The membership insert preserves A's first target hash, so replay cannot reconcile even though all source values and immutable history are correct. Separate source-content identity from import-execution identity, preserve an execution-specific immutable target membership, or explicitly reject stale archive replay before mutation with an actionable disposition. Add one A-to-B-to-A regression; do not simply update the immutable history row.

#### Minor (Nice to Have)

- None.

### Assessment

**Task quality:** Needs fixes.

**Reasoning:** The original corrections are focused and supported by meaningful reported regressions. The new source-content/target-execution identity collision must be resolved to keep repeated archive imports and immutable evidence consistent.

**Checks:** Read only the complete fix patch and appended task report; derived the remaining issue from the reviewed importer contract and new history SQL. No test reruns, additional source reads, private data access, external calls, or checkout/index mutations; wrote only this scoped review artifact.
