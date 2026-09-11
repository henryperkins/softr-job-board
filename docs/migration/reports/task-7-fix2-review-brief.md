# Phase 7 fix round 2 scoped re-review

Review only the four remaining actionable defects under R1, R5 and R7 in `task-7-fix1-review.md`, plus regressions introduced by their corrections. R2, R3, R4 and R6 are already closed. Do not reopen the original whole-task audit or add deployment/staging prerequisites to local acceptance.

Read `task-7-fix2-brief.md`, `task-7-fix2-report.md`, corrected `task-7-report.md`, and the exact frozen patch/manifest supplied with dispatch. The baseline is tree `4cf886f5901bed4c2e581b35b4d949c384cfb4e9`. Read the patch once and inspect surrounding source only for a concrete missing-context concern. Existing passing counts are evidence to assess, not grounds for automatic reruns.

- R1: all OAuth-specific JSON inspection on shared verification rows must safely handle non-JSON reset values without relying on SQL predicate ordering. Verify the ordinary reset contract and successful disconnect in the presence of a pending reset; preserve the accepted epoch/issuance invariant.
- R5: inspection must preserve the complete original file set and contents, including sidecars, for a closed WAL-mode recognized store and genuinely pending schema. It must correctly observe committed WAL contents. Review the consistency and cleanup behavior of any inspection copy; all probes must be synthetic.
- R7 logging: supported installed SDK 1.30 schema refusals must emit a finite redacted rejection event without requiring the newer optional header. Validate the actual unknown-field SDK regression and retention of finite reason/tool lists.
- R7 diagnostics: distinct allowlisted dispatch reasons must remain distinct, with a bounded fallback for unexpected stored values. No raw stored error text may leak.

The controller's first-round native run was 29 pass / 2 fail due to the reset regression. Assess the new post-fix security evidence and any narrowly necessary boundary reproduction. Do not repeat passing broad suites absent a named unresolved concern.

No source/test/index/Git edits, private historical store access, real mail/provider calls, cloud or deployment actions, localhost:8787 changes, or delegation. A bounded ignored synthetic reproducer for a concrete remaining doubt is allowed. Write only `task-7-fix2-review.md` with explicit specification and quality verdicts, closure of the four remaining defects, and exact path/line/trigger/impact for any real unresolved issue. Check source hashes remain at the frozen candidate. Stop promptly when the scoped review is resolved.
