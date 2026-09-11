# Phase 7 scoped fix round 3: R5 copy consistency only

Read `task-7-fix2-review.md` in full. R1, R2, R3, R4, R6 and both R7 defects are closed. Original-store immutability is also corrected. The sole remaining defect is R5: a checkpoint between copying the main database and copying the WAL can produce a valid-looking inspection that silently omits already-committed data.

Baseline is frozen tree `ca3be2726ea1937d0312527792968e9c95c47a6e`. Preserve all prior corrections, reviewer probes/reports, real index `64f93b5d350664320a8c1f3d0c977f337b1cd7d4`, HEAD `95799ea261871402be2598f5aea3d4109f6065f2`, SQL 0001–0006 and localhost:8787. No cloud, staging, deployment, mail/provider calls, private historical stores, Git publication, cleanup or delegation.

Ensure the copied database and sidecars form one stable snapshot, or fail closed when the source changes during capture. Original source files must remain untouched and must never be opened by SQLite. Retain correct WAL-only committed data for the existing stable snapshot case. Bound any retries/capture work; do not conceal an unstable source as an empty or successful report. Clean disposable inspection data on failure.

Add the reviewer's deterministic checkpoint-between-copies regression. A useful acceptance outcome is either the correct committed count from a valid snapshot or an explicit unstable-source failure, never silent omission. Preserve full original-file immutability assertions, including SHM. Do not merely add a documentation caveat.

Run only the focused new regression, the affected operations suite and relevant migration/operator typecheck/lint/format checks. Authentication, MCP and browser source is unchanged; do not repeat those passing suites, dry builds, dependency audits, archival scans or staging preparation. Record red/green evidence and exact changed paths in `task-7-fix3-report.md`; update `task-7-report.md` and operator documentation only as needed for the actual supported capture behavior. Attribute previous security/MCP/browser/build results to their actual rounds.

Stop source edits promptly after the scoped correction and required checks pass. Notify the controller of the stable paths; it will freeze and request a final review of this one defect.
