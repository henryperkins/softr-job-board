# Softr → Cloudflare migration progress

Updated September 11, 2026.

**Phases 1–7 are implemented, independently reviewed, committed and pushed. All seven Phase 7 findings are closed. Nothing has been deployed. Staging preparation remains stopped.**

The implementation retains your decisions: regular email/password authentication with Better Auth, fresh target accounts without account migration, and verification/reset emails from `no-reply@auth.lakefrontdev.com` through Cloudflare's native Email Service binding.

## Phase status

| Phase | Local result |
| --- | --- |
| 1. Baseline and contracts | Source inventory, identity, ownership, parity and migration rules documented and reviewed. |
| 2. Application foundation | Worker, authentication, D1, private R2 and owner-scoped services implemented and reviewed. |
| 3. Migration and recovery | Export/import, attachment mapping, replay, reconciliation and local recovery implemented and rehearsed. |
| 4. Core user flows | Persisted jobs, profiles, saves, draft editing/review and Account controls implemented and reviewed. |
| 5. Ingestion | Durable ingestion, replay and conservative legacy-job adoption implemented and reviewed. |
| 6. Draft generation | Versioned inputs, durable dispatch, quotas, revision guards and explicit human review implemented and reviewed. |
| 7. MCP and operations | Complete. Final review: specification PASS, quality PASS; findings R1–R7 closed. |
| 8. Deployment and cutover | Not performed. Ancillary staging preparation is stopped. |

## Phase 7 delivered

The app now has user-scoped MCP with 18 purpose-specific tools, explicit OAuth consent and separate read/write/generation/review permissions. Opaque tokens are checked against current grant state. Disconnect revokes live and pending credentials; later consent cannot revive an old token. Signed-out login and fresh verified signup preserve the authorization flow.

The review fixes also preserve ordinary password reset, block alternate consent-management bypasses, provide independent default-off capability flags and cover real SDK transport behavior. Rejected calls and dispatch failures produce finite, redacted operational signals.

Diagnostics inspects disposable copies without changing original SQLite files. It checks the main database and WAL/SHM contents before and after capture, retries at most three times if they change, and fails explicitly if it cannot obtain a consistent copy. A deterministic checkpoint-between-copies regression now passes.

Connection documentation, README, operator commands and the release-evidence checklist/checker are complete. The release checker validates evidence; it does not deploy or authorize a cutover.

Final approval: [Phase 7 scoped review](reports/task-7-fix3-review.md).

## Verification

These are separately recorded runs, attributed to the code they checked.

| Check | Result |
| --- | --- |
| Security | 17/17 passed in fix round 2, including the unchanged password-reset regressions. |
| MCP native integration | 42/42 passed in round 2; unchanged reviewer SDK reproducer 1/1 passed. |
| Operations | 16/16 passed in round 3, including the SQLite checkpoint race. |
| Browser | Round 1: MCP 1/1 and core/review 12/12 passed on isolated ports. |
| Ingestion / generation | Accepted Phase 5/6 runs: 25 ingestion and 37 generation tests passed. Generation was independently rerun. |
| Static checks and builds | Affected typechecks, lint and formatting passed. Web and both Worker dry builds passed in round 1; unrelated passing checks were not repeated for the final operator-only correction. |
| Production dependency audit | Latest recorded result: 224 dependencies, zero advisories. The dev-only sharp/libheif advisory predates Phase 7. |

The final review preserved earlier closures and checked only the remaining defect. It found no actionable issue in that correction.

## Data and recovery evidence

The local rehearsal reconciled 349 business records, 90 fields and 26 attachment references across six unique files. Identical replay changed zero of 375 mapped roots and copied zero objects. Historical private records are not assigned to fresh accounts.

Recovery matched 41 state files totaling 14,705,787 bytes, with five SQLite integrity checks and zero reconciliation issues. All six unique archived attachments scanned without detections/errors and retained their original checksums. They remain quarantined pending an ongoing release process.

Public Greenhouse ingestion replayed 1,376 jobs without extra versions. The separate legacy catalog rehearsal retained every existing job ID and closed none. No live model request or real verification/reset email has run.

## Deployment readiness

**Local completion does not yet establish production readiness.** Deployed email delivery, user/file isolation, restore/rollback, provider access/evaluation and exact release evidence remain unverified. The source was writable during capture, so final cutover still needs its source-freeze/export boundary.

The implementation was committed and pushed as [`0c18a2a`](https://github.com/henryperkins/softr-job-board/commit/0c18a2a6a9fdf73aa5614c0bad224d60ec892f01). No application Worker deployment, staging resource or credential creation, website DNS/routing switch, merge or PR has occurred. Production remains on Softr. The existing sender domain was verified earlier and its email activity previews were disabled; that was separate from application deployment.

Staging preparation remains stopped. No additional cloud work is underway.

## Checkpoint and handoff

The implementation is published on branch `codex/cloudflare-migration` at commit `0c18a2a6a9fdf73aa5614c0bad224d60ec892f01`, based on `95799ea261871402be2598f5aea3d4109f6065f2`. The working directory is `C:/Users/htper/Documents/Codex/2026-09-11/files-mentioned-by-the-user-softr/outputs/softr-job-board`.

The final Phase 7 review used candidate tree `2bce5e5367f7e28ae3f8263910f23e12968ff440`. Publication subsequently included formatting cleanup and a focused browser-test locator correction. SQL 0001–0006 remain unchanged. Private exports stay outside Git.

The earlier local checkpoint patch is historical recovery material. Use the published Git branch to obtain the implementation; applying that patch over the published branch would duplicate the changes.

The [handoff prompt](handoff-prompt-2026-09-11.md) contains the final state, evidence and remaining deployment boundaries. [Phase reports and reviews](reports/) are now included in the repository alongside this report. No tests or verification gates are being rerun for this documentation publication.
