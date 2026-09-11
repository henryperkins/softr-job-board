# ADR 0001: Rebuild the Softr job board on Cloudflare

- **Status:** Accepted for implementation; production cutover is not authorized by this decision
- **Date:** 2026-09-11
- **Baseline:** `95799ea261871402be2598f5aea3d4109f6065f2`

## Context

The repository contains source-era inventory and connection documentation, while the running product is implemented in Softr configuration, data, authentication, blocks, and workflows. A rebuild must preserve verified behavior and private data without crediting configuration as runtime evidence. Builder state is newer than the last published state, and two-user browser acceptance, native bindings, provider entitlements, file bytes, and email delivery remain under investigation.

The user selected regular email/password authentication and subsequently excluded account migration. Auth0 and legacy account claiming are not part of this architecture. Target accounts start fresh.

## Decision

Build two independently deployed Cloudflare Workers:

1. A React/Vite application Worker serves assets, the authenticated business API, Better Auth routes, and the application MCP endpoint.
2. A background Worker contains the scheduler, ingestion Workflows, draft-generation Workflow, and D1 outbox dispatcher.

Use dedicated D1 databases and private R2 buckets for staging and production. Private files never use a public bucket domain. Runtime credentials receive only the data-plane permissions they require.

The five business routes (`/`, `/jobs`, `/job-details?recordId=`, `/profile`, and `/saved-job-details?recordId=`) remain authenticated and private. API, auth, MCP, metadata, and protected operator paths route through the Worker before SPA fallback; an API failure must never return a successful HTML shell.

## Identity and ownership

Use [Better Auth email/password](https://better-auth.com/docs/concepts/email) with its D1-compatible database support. The core integration and local session/isolation tests are implemented; live delivery and acceptance remain pending. Better Auth manages credentials, verification, password reset, and sessions. A configured transactional email provider with staging delivery evidence is required before activation or recovery can pass. Better Auth's [database guidance](https://better-auth.com/docs/concepts/database) is the implementation reference for D1 schema generation and migration review.

Business ownership uses an immutable internal user ID. A new verified Better Auth account maps to a new business owner. Retained Softr source IDs remain archival mappings and do not grant target access. Email is a contact attribute, never a runtime owner key or an account-linking assertion. Requests cannot override the authenticated actor with a supplied user ID.

No source password, session or login account is migrated. Source records receive no target identity merely because a datasource record exists. The protected archive and local rehearsal preserve the source; no historical private data is automatically reassigned to fresh accounts. Source NOT_INVITED records remain historical records and are not activated.

Users may own multiple profiles. Every operation that depends on a profile names an owned active profile and immutable profile version. UI, API, private-file access, Workflows, and MCP call the same owner-aware domain services.

## Data and behavior contracts

- Canonical listing and detail views bind real job IDs. Legacy `?recordId=` detail URLs remain compatible. External source links allow only HTTP(S).
- Profile writes report success only after a committed server write and persist across sessions.
- Saved jobs, draft revisions, and approval history are owner-scoped and concurrency checked.
- Migrated drafts without trustworthy provenance remain labeled legacy output. Editing and approval create revisions. New generation is independent and remains off until provider/model assessment and evaluation pass.
- Ingestion dispatch occurs at or after 07:00 `America/Chicago`, with a unique source/Chicago-date key. Closure-by-absence is permitted only for a proven complete board snapshot, never a partial fetch or rolling feed.
- D1 request/outbox rows bridge database commits and Workflow dispatch. An ambiguous dispatch retries or looks up the same logical request instead of inventing a new one.
- The application MCP remains in scope. It stays disabled until its scoped OAuth, ownership, consent, revocation, and audit acceptance passes; disabled is a blocker, not completed parity.

## Exclusions

The first release does not include generic SQL MCP tools, unrestricted CRUD, automatic job applications, a public job catalog, unverified matching or personalization claims, Queues, or Vectorize. Builder administration moves to reviewed repository and Cloudflare workflows rather than becoming an application capability.

## Operational boundary

Staging and production are separate resources. Deployment and production cutover require their own explicit action after the [parity matrix](../../migration/parity-matrix.md), identity, migration, and rehearsal gates pass. Exact evidence belongs in the [evidence manifest](../../migration/evidence-manifest.md). Follow the [cutover](../../migration/cutover.md) and [rollback](../../migration/rollback.md) runbooks; this ADR is not deployment evidence.

Cloudflare implementation references: [React on Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/react/), [static asset routing](https://developers.cloudflare.com/workers/static-assets/), [D1](https://developers.cloudflare.com/d1/), [Workflows](https://developers.cloudflare.com/workflows/), and [R2 presigned URL properties](https://developers.cloudflare.com/r2/api/s3/presigned-urls/).
