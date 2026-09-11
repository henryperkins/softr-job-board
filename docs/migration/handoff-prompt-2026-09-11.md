# Handoff prompt

Resume from the **published Phase 1–7 implementation** for the Softr-to-Cloudflare migration, commit `0c18a2a6a9fdf73aa5614c0bad224d60ec892f01` on `codex/cloudflare-migration`. All original Phase 7 findings R1–R7 are closed. There is no active implementation or review subtask and nothing has been deployed.

The user stopped staging preparation with “Don't waste your time with that,” then authorized committing and pushing the work. The implementation was published; the latest request explicitly adds documentation, handoff and progress reports and forbids time-consuming gates or verification. **Staging preparation remains stopped.** Do not reopen accepted work without a concrete new issue. Proceed with subsequent work only within the user's next authorized scope.

## User decisions and paths

- Original plan: `C:/Users/htper/OneDrive/Desktop/softr-cloudflare-migration-plan-2026-09-11.md`. The user requested execution; subsequent user instructions override the document.
- Use regular email/password authentication with Better Auth, not Auth0.
- No account migration, legacy claiming, source-password transfer, invitations or automatic linking by email. New accounts start fresh; historical private records stay archived.
- Verification/reset sender: `no-reply@auth.lakefrontdev.com`, using native Cloudflare `EMAIL.send()`. No email API token is needed.
- Task root: `C:/Users/htper/Documents/Codex/2026-09-11/files-mentioned-by-the-user-softr`.
- Worktree: `C:/Users/htper/Documents/Codex/2026-09-11/files-mentioned-by-the-user-softr/outputs/softr-job-board`.
- Branch: `codex/cloudflare-migration`; implementation commit: `0c18a2a6a9fdf73aa5614c0bad224d60ec892f01`; original base: `95799ea261871402be2598f5aea3d4109f6065f2`. This documentation publication follows the implementation commit.
- Original Codex task: `01a09032-9fbc-7d33-bf7b-275d93987e85`.

Preserve staged, unstaged and untracked work. No broad staging, reset, clean, commit, push, PR, merge or deployment is implied by this handoff. Do not use the original temporary source checkout. Preserve applied SQL 0001–0006 and the existing synthetic preview on localhost:8787; use a fresh isolated port if a later browser check is necessary.

## Read first

1. [Current progress report](progress-report-2026-09-11.md).
2. [Phase 7 report](reports/task-7-report.md).
3. [Final review](reports/task-7-fix3-review.md) (PASS), [final fix report](reports/task-7-fix3-report.md), [round 2 review](reports/task-7-fix2-review.md), [round 2 report](reports/task-7-fix2-report.md) and [final controller checks](reports/task-7-fix3-controller-checks.md).
4. The latest entries of the [historical progress ledger](reports/progress.md); older phase-stop, account-claiming and staging-preparation directions are superseded.
5. Current Git state and the migration architecture, identity, parity, release-evidence, cutover and rollback documents relevant to any newly authorized task.

The same implementer, `/root/phase7_finish`, completed all three Phase 7 fix rounds. Reviewer `/root/phase7_fix1_review` completed the final scoped review. Both are finished; do not restart or redelegate accepted phases automatically.

## Accepted Phase 7 behavior

- Maintained Better Auth OAuth with S256 PKCE, signed login/consent continuation, opaque persisted tokens and current active-grant checks.
- Server-derived grant epochs bind pending authorization intent, code and token persistence. Disconnect removes pending codes and live tokens and deactivates the grant. Late issuance fails, and later same-client consent cannot revive old credentials.
- Shared password-reset values are handled safely with JSON-valid CASE boundaries; the original security assertions pass unchanged. Alternate provider consent mutations are blocked.
- Signed-out login and fresh verified signup retain the legitimate signed authorization continuation.
- Eighteen strict, owner-scoped MCP tools use shared services. Distinct read/write/generate/review scopes and independent default-off capability flags remain enforced.
- Real installed SDK 1.30 transport, credential expiry/replay/client/session misuse and queued-generation acceptance have maintained tests.
- Schema/callback refusals and dispatch failures produce finite, redacted events/reasons.
- Diagnostics opens only disposable copies of existing SQLite databases. Main/WAL/SHM source-before, source-after and copied hashes must match. It retries at most three times, then fails with a stop-writers-and-retry instruction. Original files remain unchanged; stable WAL-only data and checkpoint-between-copies are covered.
- Connection docs, README, operator tooling and release-evidence checklist/checker are complete. The checker validates observed evidence and performs no deployment or restore.

Final review is specification PASS and quality PASS; R1–R7 are closed for local acceptance. This does not establish production or deployed client acceptance.

## Verification, with correct attribution

- Round 2 security: 17/17 passed, including the unchanged previously failing password-reset assertions.
- Round 2 MCP native: 42/42 passed. The unchanged independent reviewer SDK reproducer also passed 1/1.
- Round 3 operations: 16/16 passed. Deterministic checkpoint race went RED (0 observed versus 1 committed row) to GREEN (committed row retained after retry).
- Round 3 strict migration/operator typecheck and focused formatting passed.
- Round 2 application typechecks and lint passed. The lint command has no target for operator/Node MJS paths, which use the strict migration typecheck and focused tests.
- Round 1 MCP browser 1/1 on port 8893, core/review browser 12/12 on 8894, web build and both Worker dry builds passed. These were not represented as fresh round 3 runs.
- Accepted Phase 5/6 tests: 25 ingestion and 37 generation passed; the controller independently reran generation after its final fixes.
- Latest production audit: zero advisories across 224 dependencies. Dev-only sharp/libheif advisory predates Phase 7; no unrelated dependency upgrade was made.

Do not sum these as one simultaneous run or repeat passing broad suites without changed code or a concrete concern. Known SDK sourcemap/form-body warnings did not fail the recorded assertions.

## Historical candidate snapshots and recovery

- Pre-publication Phase 1–6 index tree: `64f93b5d350664320a8c1f3d0c977f337b1cd7d4`.
- Original Phase 7 tree: `2f0b58c6192bb2254fdd55eb26a015ea33d1aa83`.
- Fix round 1: `4cf886f5901bed4c2e581b35b4d949c384cfb4e9`.
- Fix round 2: `ca3be2726ea1937d0312527792968e9c95c47a6e`.
- **Final Phase 7 review tree:** `2bce5e5367f7e28ae3f8263910f23e12968ff440`.
- Published implementation tree: `3872f0dac2fac4bd2f4dd2aec94f9ca51935841d`. Publication included formatting cleanup and a focused browser-test locator correction.
- Final scoped patch: 4 paths, 15597 bytes, SHA256 `3b53390116e28b878db4004a6da87f06d9e2e3b9a103b0f90c2bf2df2b532681`.
- Consolidated task-root `outputs/phase-1-7-local-checkpoint.patch`: 121 changed files, 2320156 bytes, SHA256 `6c9516e6827b0604d6e7cec8febf0b2bf365c5913f457864c79b227c3a03c642`. Base commit is `95799ea261871402be2598f5aea3d4109f6065f2` (tree `2e76736de176c0fe7b4dc795b17a15def31df508`). Apply only to a fresh isolated base checkout, never the active dirty worktree or a checkout with the Phase 1–6 patch already applied.

These historical snapshots used separate temporary Git indexes before publication. The implementation was subsequently committed and pushed. Manifests and patches remain local recovery artifacts; use the published branch instead of applying a checkpoint patch over it. SQL 0001–0006 remain identical to the accepted Phase 1–6 tree.

The last bounded public-tree pattern scan was on round 2: 123 files / 2288391 bytes. Its sole finding was the unchanged deliberate invalid-token redaction sentinel, independently confirmed synthetic. Do not print it or claim the scan was a comprehensive secret/PII audit. Round 3 changed only the inspection helper, its test and two documentation files, reviewed in the final four-file patch.

## Accepted earlier migration evidence

- 349 business records, 90 fields, 26 attachment references / six unique files. Replay changed zero of 375 mapped roots and copied no objects. Source was writable, so this is not a final frozen export.
- Local recovery: 41 state files / 14705787 bytes, five SQLite integrity checks and zero reconciliation issues. This is not deployed Cloudflare recovery proof.
- Six unique archived attachments scanned without detections/errors using verified ClamAV tooling, with unchanged bytes. They remain quarantined; an ongoing deployed release process is still open. Do not repeat the archival scan without a reason.
- Public Greenhouse: 1376 jobs replayed with zero extra versions. A separate legacy catalog rehearsal retained all 295 legacy IDs and closed none. No paid Fantastic Jobs/Jobven call occurred.
- Generation: immutable owned versions, durable dispatch, bounded requests, quota/revision guards, last-good edits and explicit human review. Exact selected profile claims are used; no résumé extraction, invented claims or automatic submission. No live model call has run.

Private exports, roster, signed URLs, credentials and attachment bytes stay in task-root `work/private-source/`, outside Git. Do not upload them as test fixtures or expose them in reports.

## Deployment boundary

Git publication has occurred. No application deployment, staging resource/credential creation, private remote import or website DNS/routing switch has occurred. Production remains on Softr. Earlier Phase 8 checklists, read-only preflight and secure-input helper are historical preparation; do not execute them automatically. The user reports that GitHub Actions does not work and explicitly requested this documentation push without gates or verification; do not restart CI investigation as part of publication.

The existing sender domain `auth.lakefrontdev.com` was verified. The controller earlier disabled only its email activity preview setting and verified it. No real verification/reset email was sent. Therefore do not claim there were no Cloudflare mutations whatsoever; distinguish this sender setting from application deployment. Mail, generation and MCP remote release controls remain off, and app resources remain unprovisioned.

Cloudflare account: `a77e479f6736120eadd99973dbeb705e`; zone: `de68f60938e2ed51fc5269d1d421ceea`. The cutover runbook records a legacy Worker-route trap on production apex/www; do not change routing automatically.

Future deployment work requires real email delivery, deployed user/file isolation and restore/rollback acceptance, relevant provider access/evaluation, ongoing quarantine release, exact candidate/resource evidence, and the source freeze/accepted-write boundary. These are remaining external gates, not unfinished Phase 7 local defects. Staging preparation is stopped under the latest user direction.
