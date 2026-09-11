# Production cutover runbook

Cutover is a separate, explicit deployment action. Do not run this procedure because implementation or staging gates pass. The authorized operator must name the exact release and maintenance window.

## Entry gates

- Every required row in the [parity matrix](parity-matrix.md) has exact-candidate staging evidence. Application MCP has passed independently or the user has explicitly excluded it from cutover scope.
- The [fresh-account contract](identity-activation.md) has passed with two controlled target users, and the transactional email provider is configured and verified. Source account migration and claiming are excluded by the user's correction.
- The 90-field/349-record source schema fixture, full protected export, roster archive, 26 attachment references/six unique files and local D1/R2 byte rehearsal are captured and reconciled. A final frozen-source export, reviewed exception list, scanning and exact deployed-target reconciliation remain required; baseline counts must not be assumed unchanged.
- Owner isolation is proven across UI, API, files, Workflows, and MCP. Generation readiness is independent; if its evaluation has not passed, the generation flag remains off.
- Provider entitlements, retention/republication terms, source adapters, and the at-or-after 07:00 `America/Chicago` dispatcher are verified.
- Staging and production use dedicated D1 and private R2 resources. Restore and both pre-write and post-write rollback paths have been rehearsed.
- The [pre-write release checklist](release-evidence.md#pre-write-authorization-checklist) is complete for the exact candidate. The later [post-write closeout manifest](release-evidence.md#post-write-closeout-manifest) records the first accepted target write, exact Git commit, application/background Worker version IDs, D1 migration ledger, resource identifiers, release configuration, source/export manifests, attachment checksums and recovery bookmark without fabricating future evidence.

Failure or missing evidence blocks cutover. A passing working tree or local test run is not a deployed-release artifact.

## Capture the pre-cutover recovery point

Record the effective published Softr behavior, Softr subdomain state, application MCP state, workflow/schedule state, complete data and attachment manifest, provider secret references, and current Cloudflare release. Capture the relevant Cloudflare DNS records, Worker routes, Custom Domains, and other consumers of `lakefrontdev-origin-proxy`.

The current routing facts to reconcile are:

- `www` is a DNS-only CNAME to the apex.
- The apex is a DNS-only A record to `35.158.87.123`.
- Stored apex and `www` routes point to `lakefrontdev-origin-proxy` and can become effective when DNS is proxied.

Validate the actual pre-cutover effective routing and rehearse its restoration. Do not define rollback as blindly restoring a stored route that would send users to the unrelated legacy origin. Preserve all unrelated DNS, mail, subdomain, and Worker records.

## Ordered maintenance-window procedure

1. Announce maintenance and confirm the authorized exact release and operators. Set target user writes, application MCP writes, generation, and target scheduling off.
2. Freeze every source writer: user mutations on the custom Softr domain and Softr subdomain, app MCP mutations, administrative changes, ingestion schedules, and workflow triggers. Let in-flight operations settle and prove the source is quiescent. If a reliable freeze or complete change capture cannot be established, stop.
3. Produce the final complete source export, including system metadata, deletions since rehearsal, relations, roster state, attachment references, and actual attachment bytes. Reconcile it against the rehearsal's 90 fields, 349 records, 26 references, and six unique files without assuming those counts are unchanged. Hash the export and each file.
4. Import or reconcile to production D1 and private R2 with target writes disabled. Preserve source IDs, immutable R2 versions, legacy draft classification, profile versions, ownership, and source timestamps. Quarantine and disposition every exception.
5. Perform byte and relationship reconciliation: schemas, record content, counts, status distributions, owner links, reciprocal links, legacy IDs/URLs, attachment size/type/checksum/object key, and explicit exceptions. Record the final D1 recovery bookmark and migration ledger.
6. Remove or reconcile the apex and `www` routes to `lakefrontdev-origin-proxy` before enabling proxied DNS or binding the new Worker. Check the proxy Worker's other dependencies before changing or retiring it. Reconcile the existing `www` CNAME before creating a conflicting Worker Custom Domain. Preserve unrelated DNS/mail records.
7. Route the intended canonical `www` hostname to the exact application Worker version and configure the deliberate apex redirect while keeping target writes and schedules off. Preserve paths and query strings, including legacy `recordId` URLs.
8. Validate reads first: DNS/TLS and canonical host behavior, error routes, fresh-account verification/login/logout, all five private business routes, owner isolation, job details and owned saved-job/draft/file paths. Retained historical private records must not become accessible merely through a matching email. Check alternate/preview/`workers.dev` entry points do not bypass policy.
9. If read validation passes, enable target user writes. Run bounded write tests for profile persistence, saves/status/notes, draft editing/approval, and attachment operations with controlled users. Confirm every accepted write appears once in D1/R2 and the audit trail. This is the rollback boundary.
10. Enable the production ingestion scheduler exactly once and verify its unique source/Chicago-date keys, outbox dispatch, source freshness, and safe no-closure behavior for incomplete feeds. Keep generation off unless its independent evaluation passed. Enable application MCP only if its independent gate passed.
11. Monitor accepted writes, authentication/authorization failures, delivery failures, source age, workflow backlog, errors, attachment access, and reconciliation drift. Record every release/configuration change in the evidence manifest.
12. End maintenance only after the success criteria pass. Retain Softr read-only for the bounded recovery period. Retire credentials, workflows, routes, and paid dependencies only after final reconciliation and explicit retirement approval; never leave the Softr subdomain as a second writable public application.

Cloudflare routing references: [Worker routes and precedence](https://developers.cloudflare.com/workers/configuration/routing/routes/) and [Custom Domain constraints](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

## Success criteria

- No accepted source write is missing from the target, and every accepted post-enable target write is durably recorded once. The recovery objective is **no lost accepted user writes**.
- Controlled users pass the private route, identity, owner-isolation, persistence, legacy-link, and file checks against the exact production Worker versions.
- Final export/import reconciliation has no undispositioned record, relationship, identity, or byte exception.
- Exactly one application writer and one ingestion schedule are active. Generation and MCP state match their independent gates.
- DNS/routes resolve to the intended version without disturbing unrelated DNS, mail, subdomains, or Worker consumers.

On any failure, stop new changes, preserve evidence, and follow [rollback.md](rollback.md) according to whether target writes have been accepted.
