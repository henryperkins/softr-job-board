# Task 5 fix round 1 — ready for scoped re-review

Fixed only the two Important findings in task-5-review.md. Read the ignored review reproducer as evidence and added native red-to-green regressions. No schema, migration, configuration, dependency, application/auth/UI or generation changes. No staging, commits, deployment, provider network, paid calls or preview restart.

## Corrections

1. Closure absence is now `NOT EXISTS` in the finishing run's retained backlog membership, not a comparison with the mutable last-observed run pointer. Candidates with `observed_at` newer than the capture are excluded even if their newer run is still importing. The circuit-breaker population also excludes newer observations so newer incoming records cannot inflate the removal allowance. Before each closure, its transaction guard repeats membership, timestamp, source identity, stable ownership and open-status checks alongside the existing job revision check. A newer unchanged import arriving after selection now aborts the closure transaction without changing job/version/audit state.
2. Canonical reuse now requires positive identifier evidence: a numeric/UUID/recognized requisition ID in a job path, an opaque UUID path (for example Lever), or an explicitly named numeric/UUID/requisition query ID. Bare text following `/jobs` is insufficient. Search/all/category/browse/filter paths are rejected unless an explicit job query ID supplies positive evidence. Unproven URLs use existing separate source/external identity plus nonmerge review disposition. Legitimate Greenhouse numeric URLs, Stripe numeric listing paths, UUID URLs, REQ-style IDs and meaningful query parameters remain intact.

## Focused validation

- Red command: `pnpm exec vitest run --config vitest.jobs.config.ts -t 'closure excludes|closure uses immutable|closure transaction rejects|generic listing and category'` — **4 failed / 21 skipped** against the staged pre-fix implementation. Failures reproduced: newer unfinished unchanged observation incorrectly closed; same-capture pointer replacement incorrectly closed; after-selection unchanged import did not reject; `/jobs/search` accepted as canonical identity.
- Green command: `pnpm test:ingestion` — **25 tests passed**, 14.49 seconds total.
- `pnpm exec tsc -p tsconfig.jobs.json` — passed.
- `pnpm exec eslint workers/jobs/src --config eslint.jobs.config.js` — passed.
- `pnpm build:jobs` — passed actual Wrangler background dry build; 1,081.95 KiB upload / 183.28 KiB gzip; all flags still false. No deployment.
- No broad app, browser, migration or unit suites were repeated.

The four new tests cover:

- A newer source run has imported an unchanged record but has not finished; the older run does not close it.
- A replay with the same capture timestamp changes the mutable source pointer; immutable older-run membership still prevents false absence.
- A newer unchanged observation is injected between candidate selection and D1 batch commit. Job revision stays unchanged, but the repeated timestamp/membership guard rejects the batch and preserves Open status and version count.
- Search/all/category and numeric search URLs produce eight distinct jobs, eight aliases and eight review dispositions for eight external identities. Positive Greenhouse/Stripe/UUID/requisition and query-ID examples are preserved exactly.

## Single requested persistent shadow replay

```powershell
pnpm ingestion:shadow --snapshots C:/Users/htper/Documents/Codex/2026-09-11/files-mentioned-by-the-user-softr/work/source-providers/greenhouse-20260911 --local-store C:/Users/htper/Documents/Codex/2026-09-11/files-mentioned-by-the-user-softr/work/ingestion-shadow-task5-persistent --date 2026-09-13 --captured-at 2026-09-11T12:35:10Z
```

Reopened the existing protected persistent store. No recreation, reset or schema edit. Original capture timestamp and source hashes retained; September 13 is only a synthetic replay run label.

Accepted report:

`C:/Users/htper/Documents/Codex/2026-09-11/files-mentioned-by-the-user-softr/work/ingestion-shadow-task5-persistent/shadow-report-1789135502738.json`

- Replay timestamp: 2026-09-11T14:05:02.738Z.
- Final corrected harness hash: `51cd605c5828a1874bd2e9dd10c9915cd863ff6d80bce616af647d1f56c3457d`.
- Anthropic **594 unchanged**, Stripe **626 unchanged**, Figma **156 unchanged** = **1,376 unchanged**.
- **Zero created, updated, closed, rejected, identity reviews or new versions**; all three source runs succeeded complete.
- Last-successful source observation remains the original 2026-09-11T12:35:10Z; no fabricated freshness.
- Prior partial/ephemeral diagnostic stores remain superseded as described in task-5-report.md. Paid-provider live acceptance remains pending. Parent's separate 295-job seeded shadow was not touched or rerun by this agent.

## Changed files

- workers/jobs/src/ingestion.ts
- workers/jobs/src/providers.ts
- tests/jobs/ingestion.test.ts

This ignored report is the handoff artifact. `git diff` contains only those three implementation/test corrections: 180 insertions, 13 deletions at handoff. All fixes are unstaged. Editing stopped for scoped re-review.
