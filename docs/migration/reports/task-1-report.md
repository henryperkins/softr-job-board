# Task 1 report: migration contracts

## Status

Implemented the bounded documentation contract. No connector/browser work, runtime implementation, external writes, commits, pushes, deployments, data migrations, DNS changes, or account activation were performed.

## Files

- `docs/migration/parity-matrix.md`
- `docs/architecture/decisions/0001-cloudflare-migration.md`
- `docs/migration/identity-activation.md`
- `docs/migration/cutover.md`
- `docs/migration/rollback.md`

## Verification

- Confirmed every required parity surface is classified and includes target behavior, an exact acceptance test, and evidence status/owner.
- Incorporated the controller's fresh redacted baseline: 90 fields/349 records, all five business page gates `LOGGED_IN_USERS`, consistent relationship checks, multiple-profile distribution, and 26 downloaded attachment references representing six unique size/signature-matched files.
- Recorded Cloudflare Email Sending's 1,000/day limit and 0 usage alongside the absence of a `lakefrontdev.com` sending subdomain; email setup/delivery remains pending and nothing was enabled.
- Confirmed the Better Auth/D1 identity decision, immutable internal owner IDs, verified one-time claiming, ambiguity rejection, `NOT_INVITED` handling, and pending password/email evidence are explicit.
- Confirmed architecture scope and exclusions, profile/version persistence, legacy URL handling, draft-generation gate, MCP blocker, Chicago ingestion schedule, complete-snapshot closure, and D1 outbox semantics are present.
- Confirmed cutover includes source/Softr subdomain/MCP/ingestion freeze, final export and byte reconciliation, current DNS/route facts, read-before-write validation, exact release evidence, and the first-target-write rollback boundary.
- Confirmed rollback preserves accepted writes, retains D1 for application rollback, requires rehearsed target-delta replay before returning to Softr, treats D1 restore as a separate destructive action, and keeps immutable R2 versions.

## Concerns

- The five files are contracts only; all pending evidence remains pending until the controller records exact-candidate artifacts in `docs/migration/evidence-manifest.md`.
- Email setup/delivery, billing-subscription evidence, provider entitlements, native action targets, malware scanning, target R2 migration/authorization, and two-user browser acceptance remain release blockers or unresolved evidence items as assigned in the parity matrix.
