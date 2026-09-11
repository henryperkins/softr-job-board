# Phase 8 staging acceptance checklist

Preparation only. No staging resource or application deployment has occurred. The Phase7 review/fix gate and whole-branch review precede these actions.

## Candidate and account

- Record the accepted local candidate commit, clean candidate tree, lockfile and build hashes. Existing Phase1–6 is preserved separately; do not overwrite the active mixed worktree.
- Current account entitlements now confirm Workers, D1 and R2 enabled, with sufficient recorded D1/Workflow capacity for the dedicated staging resources. See `phase-8-account-entitlements-2026-09-11.json`: 13 D1 databases use 35,926,016 bytes against the reported 50,000-database / 1,000,000-MB allocations; seven Workflows have zero queued/running instances. The billing-plan name, spending cap and D1 recovery-window terms remain unverified. Those cannot be inferred from Workflow retention. Use existing allocations for bounded staging only; do not purchase or upgrade a plan.
- Record the two user-approved test inboxes. They must create fresh application accounts; historical private records stay unassigned. Inbox identifiers are still pending. Send only the bounded signup/verification/reset test messages authorized for these accounts.

## Dedicated staging infrastructure

| Component | Prepared target | Evidence to record |
| --- | --- | --- |
| Host | `job-board-staging.lakefrontdev.com` | Exact Cloudflare Access application/policy and Custom Domain identifiers; no alternate ingress |
| Application Worker | `job-board-app-staging` | Candidate provenance, Worker version/deployment identifiers, effective bindings/flags |
| Background Worker | `job-board-jobs-staging` | Version/deployment identifiers, no HTTP ingress, both Workflow bindings, schedules disabled |
| D1 | `job-board-db-staging` | New dedicated database ID, all applied migration hashes/ledger, recovery bookmark |
| Private R2 | `job-board-private-staging` | Dedicated bucket, no public domain or public development URL, synthetic object checksums |
| Email | `no-reply@auth.lakefrontdev.com` | Restricted native Worker binding and redacted delivery evidence for approved test inboxes |

The targets were absent at the recorded read-only preflight. Recheck exact targets immediately before provisioning; do not reuse a resource created by another task. Restrict staging with Access before exposing the host. Keep `workers.dev` and preview URLs off. Generate a staging-only authentication secret through protected input, never command arguments or Git. Keep source ingestion and generation disabled. Apply additive schema only to the new staging database.

## Acceptance against the exact deployed versions

1. Confirm hostname, TLS, Access and non-HTML API/MCP failures. Verify alternate hosts cannot bypass protection.
2. With the approved inboxes, demonstrate real signup, verification, reused/expired verification, login, reset, reused/expired reset, logout and session revocation. Store redacted outcomes rather than message bodies or secret URLs.
3. Exercise owner isolation through rendered UI, HTTP API, private files and MCP for both accounts. Include forged owner IDs, missing/insufficient scopes, signed-out OAuth continuation, client/code/refresh boundaries, Account disconnect and re-consent.
4. Exercise enabled capability gates individually, with model/provider calls still off. Record queued generation only where the local contract permits it; no local mock is live model acceptance.
5. Demonstrate persistence, revision conflicts and accepted-write audit continuity with disposable test records. Retain checksums of synthetic private objects. No protected source archive belongs in this test fixture.
6. On staging only, rehearse D1 recovery and the documented Worker rollback paths before and after accepted writes. Preserve an incident copy and every accepted test write; record exact versions and bookmarks. A production Time Travel restore is a separate destructive action.
7. Link actual evidence to the pre-write checklist. The post-write closeout schema may be filled only after real target writes exist; no placeholders, invented version IDs or future timestamps.

Production remains governed by the cutover runbook: exact release and maintenance window, supported freeze of every Softr writer, final export and reconciliation, deliberate canonical routing, read acceptance before writes, then one ingestion schedule. Preserve unrelated DNS/mail and resolve the stored `lakefrontdev-origin-proxy` route conflict. Passing this staging checklist alone performs none of those actions.

## Verified CLI interfaces for the later rehearsal

Wrangler4.131.0 local help was checked, without running remote data operations. The D1 Time Travel info and restore commands act on remote databases; neither is a local simulation. Always select the explicit staging configuration and named dedicated staging database. Info supports --json and --timestamp. Restore accepts an exact --bookmark or --timestamp; its generic help text does not establish the account recovery window. D1 export supports --remote and requires --output; keep any data export in the protected staging evidence directory outside Git. Worker rollback accepts an explicit version ID plus --env staging, --config and a reason message. Do not rely on an implicit previous version or a DNS-only rollback after accepted writes. No export, rollback or restore command was executed during this interface check.

## Non-browser access during MCP acceptance

Staging Access must protect protocol requests as well as the browser. Browser sign-in alone does not give an SDK or desktop client an Access credential. For the controlled test harness, prepare a short-lived, staging-only Service Auth credential with an exact service-token policy; keep its two credentials in protected runtime input. Send CF-Access-Client-Id and CF-Access-Client-Secret separately from the application's Authorization bearer token. Verify the selected desktop client's discovery, registration and token requests can carry those Access headers before claiming client compatibility. If they cannot, record the unsupported test path; do not add an anonymous Access bypass. A request with only the Access service credential must still fail app-user MCP authorization. No credential or policy has been created in this preparation. [Cloudflare service-token documentation](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/).
