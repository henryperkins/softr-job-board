# Phase 8 preparation — September 11, 2026

User authorization now says "Finish Phase 7 and move on." Finish and independently review Phase 7 first. The initial stop-before-7 boundary is superseded. Source plan and cutover/rollback contracts still require exact-candidate acceptance before production routing or source freeze. Preparation and controlled staging are the next work; no cutover is authorized by a passing manifest alone.

## Confirmed current prerequisites

- Isolated branch codex/cloudflare-migration, base 95799ea261871402be2598f5aea3d4109f6065f2. All work remains local and uncommitted.
- Read-only Cloudflare preflight at 2026-09-11T15:33:49.936Z: no matching job-board Workers, D1 databases or R2 buckets; no DNS record, custom domain or Access app for job-board-staging.lakefrontdev.com. Names in tracked config are available: job-board-app-staging, job-board-jobs-staging, job-board-db-staging, job-board-private-staging, job-board-ingest-staging, job-board-generate-staging.
- Account a77e479f6736120eadd99973dbeb705e, zone de68f60938e2ed51fc5269d1d421ceea. Wrangler 4.131.0 is authenticated via OAuth to this account. API resource reads work with explicit account_id; the subscriptions endpoint alone returns authentication error10000. Default Workers usage model is standard, which does not prove subscription terms or remaining budget. Dashboard in-app browser was signed out; temporary lookup tab closed.
- Exact no-reply@auth.lakefrontdev.com sender is configured for native EMAIL binding. Account quota1000/day, sent0. No real messages sent. Two controlled fresh-account test inboxes have been requested asynchronously; identifiers/authorization are pending.
- Raw read-only preflight is summarized outside Git at outputs/phase-8-preflight-2026-09-11.json. Do not publish private account inventories or email addresses in a public artifact.

## Concrete order after Phase 7 approval

1. Perform one whole-branch review and resolve its material findings. Preserve the frozen reviewed Phase 1–6 patch; do not reset the mixed worktree. Stage only identified reviewed paths and create an exact local candidate commit if needed for release provenance. A local commit is not push/merge/deployment authorization. Record code/build hashes and all additive migration hashes against the candidate.
2. Resolve account subscription/quota evidence without purchasing or upgrading a plan. Choose the unused hostname above and restrict staging with Cloudflare Access before exposing it. Restrict interactive access to approved test users, disable workers.dev and preview URLs, and avoid wildcard/bypass policies. Keep the jobs Worker without an HTTP ingress.
3. Provision only dedicated staging D1/private R2 and the two Workers/Workflow definitions. Never reuse other projects' databases/buckets or upload archived personal source data as synthetic test data. Use the existing native email binding, a generated staging-only Better Auth secret through secret bulk/secure input, and configuration with real staging resource IDs. No secrets in shell command arguments, Git, reports or logs. Keep generation/ingestion flags off; no paid provider calls.
4. Apply additive schema on the new staging DB, deploy the exact reviewed candidate, record both Worker version IDs, and verify the effective Access/custom-domain and alternate-host protections. Mail and writes stay disabled until controlled acceptance is ready; enabling for a bounded staging test is not production readiness.
5. With the user's two approved inboxes, run real signup/verification/reuse/expiry/reset/session checks from the selected sender, then owner-isolation through UI/API/files/MCP using fresh accounts. Synthetic generation/provider mocks cannot satisfy model access/evaluation. Capture redacted timestamps, result counts and request IDs; never verification/reset/OAuth tokens.
6. Rehearse staging-only DB recovery and both pre-write/post-write Worker rollback paths with only disposable synthetic/test records. Preserve an incident copy and every accepted test write. A production D1 Time Travel restore remains a separate destructive action; do not infer authorization for it.
7. Fill the Phase 7 release evidence template with real exact-candidate deployed evidence. Missing values remain failures. Keep before-write gate evidence distinct from post-write closeout: never fabricate a first accepted target write to satisfy a schema. Capture final source export only after an explicitly scheduled, supported freeze of every source writer, and keep production writes disabled until reconciliation/read acceptance.
8. Once all production prerequisites are concrete and reviewable, obtain the exact release/maintenance-window action required by docs/migration/cutover.md. A broad "move on" does not establish the missing time, release IDs, source freeze or reconciliation. Do not ask this permission prematurely while code/staging work remains.

## Open release dependencies

- Account billing/quota evidence; test mailbox identifiers; actual verification/reset delivery.
- Deployed owner-isolation and private-file acceptance; ongoing quarantine-release policy and trusted scanning/release path. Completed local scan of six archived files is separate evidence and does not release new uploads.
- Provider entitlements/retention rights, live scheduling and source observations. Generation can stay off until Anthropic access/evaluation passes.
- Exact candidate commit, cloud resource/version IDs, deployed restore/rollback rehearsal, supported all-writer source freeze, final export/import reconciliation and deliberate website routing.

Preserve source Softr, www/apex DNS, unrelated auth/domain consumers, the original temporary checkout and stable localhost8787. No source freeze, private target import, new email, provisioning or deployment has occurred in this preflight.

### Account-plan lookup follow-up

At about 11:22 America/Chicago, the controller also checked the available Edge profile using the user-supplied sender-dashboard URL. It was signed out, like the in-app browser. No credentials were entered and no sign-in was attempted; the temporary tab was closed. The existing async plan question remains pending. Do not infer the plan from the standard usage model or repeatedly retry the denied subscription endpoint.

### Later quota evidence supersedes the initial subscription-only block

A further documented, read-only GET /accounts/{account_id}/entitlements succeeded. Workers/D1/R2 are enabled; current D1 allocations are 50,000 databases, 10,000MB/database and 1,000,000MB/account. Full inventories show 13 databases totaling35,926,016 bytes and seven Workflows with zero queued/running instances. Active Workflow allocations include10,000 concurrent and1,000,000 queued instances. Redacted selected evidence is outputs/phase-8-account-entitlements-2026-09-11.json outside Git. These observations establish capacity for the small dedicated staging target; lack of a human-readable plan name alone need not block bounded staging preparation once local reviews pass. Do not infer billing terms, a spending cap or D1 Time Travel retention from these entitlements. No upgrade or paid provider call is authorized. Test inboxes remain required for real delivery/identity acceptance. Until inboxes arrive, any protected staging resource can remain with mail/writes/generation/ingestion off and exact Service Auth protection; do not treat synthetic verified users as delivered-email proof. No cloud mutation occurred during these reads.
