# Production deployment — September 11, 2026

The user explicitly authorized deployment to Cloudflare Workers without repeating completed gates. Production routing switched at approximately **18:43 UTC**. The application is available at [www.lakefrontdev.com](https://www.lakefrontdev.com).

## Deployed resources

| Resource | Identifier |
| --- | --- |
| Cloudflare account | `a77e479f6736120eadd99973dbeb705e` |
| Zone | `de68f60938e2ed51fc5269d1d421ceea` |
| Application Worker | `job-board-app-production` |
| Application version, including auth secret | `0ab09a92-0ba4-4c6d-857b-fa63169f20a3` |
| Application deployment | `2cd4f46d-bfcf-46fa-9bb2-baea7e9c7dbf` |
| Background Worker | `job-board-jobs-production` |
| Background version | `7b78d143-5f82-4f4b-a565-922323c96a89` |
| Background deployment | `f7feb98b-e38f-4801-9abd-0fe6a5a8d4d6` |
| D1 | `job-board-db-production` / `efc82cbe-a4f4-484f-8502-63f16cf44d1e` |
| Private R2 | `job-board-private-production` |
| Workflows | `job-board-ingest-production`, `job-board-generate-production` |
| Redirect ruleset | `51cb8d8e44ac44929cfcacc096df5662` |
| Canonical redirect rule | `07f7e106a5a34da8b54f34df8cd37d8d` |

The executable application comes from implementation commit `0c18a2a`, followed by documentation commit `2679c9d`. This deployment adds production binding values, routes and the SQL compatibility repair described below. Both Workers use the existing built application assets; no package installation, test suite, audit, dry build or GitHub Actions investigation was repeated.

## Runtime configuration and data

Regular Better Auth email/password accounts start fresh. Native Cloudflare mail is enabled with `no-reply@auth.lakefrontdev.com` as the sole allowed sender. A new production auth secret was generated and uploaded through `wrangler secret bulk`, without displaying its value.

User writes and MCP read/write/review are enabled. Generation, MCP generation, ingestion acquisition and ingestion writes remain disabled; provider credentials were not available. The background Worker and both Workflows are deployed. Its minute trigger runs, but disabled capabilities perform no acquisition or generation.

All seven migrations are applied. D1 contains **295 jobs**, matching job versions, legacy source attribution and ID mappings. These are the public job records from the source export completed at `2026-09-11T11:26:35.287Z`. User links were excluded. No historical accounts, profiles, saved jobs, drafts or attachment bytes were imported. The original archive is retained locally. This is a catalog snapshot; source freeze and ongoing synchronization were not performed.

The catalog import completed 1,181 SQL statements. Its recovery bookmark, before live user activity, was `00000004-0000025c-000050e3-f744a0663639e2dcd70d7b97db14670b`.

## Deployment repair

D1 accepted migrations 0001–0006 but its remote SQL parser rejected migration 0007 with `incomplete input`. The failure was isolated to CASE expressions inside OAuth trigger definitions. Equivalent boolean expressions, `iif` and `SELECT RAISE(...) WHERE` preserve epoch changes, safe handling of non-JSON reset values and active-grant enforcement without CASE/END parsing ambiguity.

The first 20 statements were applied while isolating the failure; the remaining four trigger definitions and migration ledger entry were applied successfully together after the repair. All six OAuth triggers are present. A focused remote check accepted and removed an ordinary reset-value probe, then rejected a forged authorization code with `oauth_grant_inactive`. No test account was created.

The initial jobs upload encountered a transient Worker-not-found response while publishing its subdomain setting. Retrying completed the deployment and both Workflow bindings.

## Routing and brief live checks

Existing apex and `www` routes now point to `job-board-app-production`. Their DNS record values are preserved, with proxying enabled. A Cloudflare redirect rule sends the apex and HTTP `www` to canonical HTTPS, preserving paths and query strings. Workers development and preview URLs remain disabled. Unrelated hostnames and mail records were unchanged.

At approximately 18:44 UTC, direct requests to the newly resolved Cloudflare edge confirmed:

- Login HTML, JavaScript and stylesheet: HTTP 200 with expected content types.
- Apex legacy-style URL: HTTP 308, with the original path and `recordId` query retained.
- MCP resource discovery: HTTP 200, advertising `https://www.lakefrontdev.com/mcp` and the application's scopes.
- Signed-out auth session: HTTP 200 with `null`.
- Private jobs API without authentication: HTTP 401.
- D1: seven migration ledger entries, six OAuth triggers, 295 jobs and zero accounts at the recorded check.

The machine's initial cached DNS response still reached Softr; Cloudflare DNS and requests directed to the new edge confirmed the new application. Real email receipt and a full authenticated browser journey were not exercised during this deployment. Earlier local test evidence remains separately attributed.

## Recovery context

Before the switch, apex A record `51a0236c54a47ff687d4fe0c1982380b` pointed to `35.158.87.123` without proxying. `www` CNAME `8aa905de8b5aa2fc9987c239c15b843e` pointed to the apex without proxying. Stored routes `a8d08dd5151d4a75839b71a18bc8683f` (apex) and `4406b199b2d245c38bd65508aa62f414` (`www`) pointed to `lakefrontdev-origin-proxy` but were ineffective while DNS was unproxied.

The old Worker and Softr source were preserved. Do not blindly restore their old stored routes under proxied DNS: that is the previously documented legacy-origin trap. Any future rollback must account for accepted new production writes and fresh account state; the pre-user-activity bookmark is not authorization to discard later writes.
