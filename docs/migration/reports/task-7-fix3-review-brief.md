# Phase 7 final scoped re-review: R5 copy consistency

Review only the remaining R5 checkpoint-between-copies defect in `task-7-fix2-review.md` and regressions introduced by this correction. All other Phase 7 findings are closed. Baseline tree is `ca3be2726ea1937d0312527792968e9c95c47a6e`; the stable candidate, patch and manifest accompany dispatch.

Read the narrow patch, `task-7-fix3-report.md` and corrected consolidated report. Confirm copied main/WAL/SHM represent a consistent capture or inspection fails explicitly when the source changes; capture work is bounded; original files remain untouched; stable WAL-only committed data is retained; failed disposable captures are cleaned up. Assess the deterministic checkpoint regression and relevant operations/static results. Do not reopen unrelated diagnostics, OAuth, transport, deployment or staging work, and do not repeat passing broad suites.

No source/test/index/Git edits, private historical stores, real mail/provider/cloud/staging actions, localhost:8787 changes or delegation. A bounded synthetic probe is allowed only for a concrete remaining doubt about this correction. Write only `task-7-fix3-review.md` with explicit specification and quality verdicts, R5 closure or the exact unresolved trigger/path/impact, and a final frozen-hash check. Stop promptly once this one defect is resolved.
