# Production rollback runbook

The first accepted target write divides two recovery procedures. Record that timestamp and write/audit sequence in the [evidence manifest](evidence-manifest.md). The recovery objective is **no lost accepted user writes**.

## Common response

1. Declare the incident, preserve request/run identifiers and redacted logs, and stop further release changes.
2. Disable target user writes, application MCP writes, generation, and ingestion dispatch as required to bound the incident. Let known in-flight operations reach an authoritative state; preserve D1 outbox rows rather than creating replacement requests.
3. Record the exact Git commit, application/background Worker version IDs, D1 migration ledger and recovery bookmark, R2 object versions, DNS/routes, flags, accepted-write boundary, and observed failure.
4. Confirm whether any target write was accepted. When uncertain, treat the incident as post-write until reconciliation proves otherwise.

## Before any target write was accepted

Restore the validated pre-cutover effective website routing, then verify it from both apex and `www`. Do not blindly restore the stored `lakefrontdev-origin-proxy` routes: the validated recovery state must not send users to the unrelated legacy origin.

Restore Softr user writes, its subdomain/custom-domain access, app MCP state, and ingestion schedule only to the captured pre-cutover configuration. Prove there is one active scheduler and one writable application. Preserve unrelated DNS, mail records, subdomains, Worker routes, and any other proxy-Worker consumers.

Validate login, the five private business routes, legacy query URLs, owner-scoped reads, attachments, and source ingestion state with the controlled users. Keep the target read-only for diagnosis. Record the restored DNS/routes, source configuration, and verification results.

## After a target write was accepted

A DNS switch to Softr is not a safe rollback. Prefer application rollback on Cloudflare:

1. Keep D1 and private R2 intact and writes frozen.
2. Deploy or route to the previously rehearsed, schema-compatible application/background Worker versions.
3. Validate schema compatibility, authentication, private reads, accepted target writes, attachments, outbox state, and owner isolation before reopening writes.
4. Resume exactly one scheduler only after its logical run/outbox state is reconciled. Keep generation and MCP state at their last independently proven configuration.

Returning to Softr after target writes is allowed only through a rehearsed target-delta replay:

1. Keep both systems frozen and enumerate every accepted target mutation since the final source export, including fresh users, profile and saved-job revisions, draft review, attachments, and workflow results. Source account migration and claims are excluded.
2. Transform and replay the delta idempotently to a supported source target. Reconcile created identities without auto-linking by asserted email, and copy or disposition every new file version.
3. Prove source content, relationships, ownership, bytes, and accepted-write counts against the audit boundary.
4. Restore the validated effective Softr routing and source schedule, run controlled-user acceptance, then reopen Softr.

If delta replay is not rehearsed or reconciliation is incomplete, remain in maintenance and roll forward. Never discard accepted target writes to regain availability.

## D1 and R2 recovery

D1 Time Travel restore is a distinct destructive production action requiring separate authorization and a newly verified recovery window for the actual plan. It is not equivalent to rolling back a Worker version. Before any restore, preserve the incident database/bookmark, prove the target bookmark, enumerate writes that would be removed, and define their replay. See [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).

A D1 restore does not undo R2 objects, emails, provider calls, DNS changes, or Softr mutations. R2 objects use immutable versioned keys; retain all versions and reconcile the database's attachment references instead of overwriting or deleting objects during incident response. Any later D1 restore or R2 deletion remains its own destructive action.

## Recovery exit criteria

- The chosen application version, database state, object references, flags, routes, and scheduler are mutually compatible and recorded.
- Every accepted write is present once or has a reviewed replay/disposition; no identity or ownership mapping is ambiguous.
- Two controlled users pass authentication, private-route, cross-owner denial, persistence, and attachment checks.
- There is one writable application and one active ingestion scheduler; old Softr and MCP writers are not unintentionally exposed.
- Continued monitoring shows stable authentication, authorization, file access, source freshness, workflow backlog, and outbox state.

Do not retire recovery resources or credentials as part of rollback. Retirement requires later reconciliation and explicit approval.
