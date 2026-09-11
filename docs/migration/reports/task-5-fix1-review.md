# Task 5 fix round 1 independent re-review

**PASS — both previously reported Important findings are resolved.** No remaining actionable finding within this scoped re-review.

Reviewed `task-5-fix1.patch`, `task-5-fix1-report.md`, and the changed closure/URL logic and four regression tests. The patch is limited to ingestion.ts, providers.ts and ingestion.test.ts. No unrelated Task 5 scope, UI/auth/account migration or generation work was reopened.

- Closure now derives absence from the finishing run's retained backlog membership, excludes newer per-record observations, and repeats membership/freshness/identity/ownership/open-status checks inside the same transaction as the close/version/audit writes. This addresses both the original overlapping-run counterexample and an unchanged newer observation arriving after candidate selection. The more conservative circuit-breaker population does not inflate the permitted removal count with newer observations.
- Canonical URL reuse now requires positive numeric/UUID/requisition identifier evidence instead of arbitrary text following `/jobs`. Generic search/all/category paths preserve distinct source identities and receive review dispositions. The positive Greenhouse, Stripe, UUID, requisition and query-ID cases retain their full URLs and meaningful parameters.

Independently ran the focused native-runtime command:

`pnpm exec vitest run --config vitest.jobs.config.ts -t 'closure excludes|closure uses immutable|closure transaction rejects|generic listing and category'`

Result: **4 passed, 21 skipped**, one test file passed; exit 0; Vitest duration 4.04 seconds. These regressions cover both reported defects and the relevant transaction-race/membership variants. The implementer's 25-test suite, types/lint/dry-build and corrected-harness persistent replay evidence were read as reported evidence; they were not broadly rerun. The reported corrected replay remains 1,376 unchanged with zero new versions/reviews under harness `51cd605c5828a1874bd2e9dd10c9915cd863ff6d80bce616af647d1f56c3457d`.

No implementation/test edits, staging, commits, deployments, live provider calls, private source reads, shared persistent-store mutations or localhost:8787 preview changes were performed in this re-review. Only this ignored review artifact was written.
