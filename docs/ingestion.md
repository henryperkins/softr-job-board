# Durable ingestion

`workers/jobs` exports `IngestSourceWorkflow`. HTTP always returns 404: there is no normal-user or fake-auth operator endpoint. D1 and private R2 use the same local resource names as the app. The background-only secrets are `FANTASTIC_AUTHORIZATION` (the complete configured Authorization value) and `JOBVEN_API_KEY`. Missing credentials fail only their source. No paid-provider call or live provider acceptance was performed.

`INGESTION_SCHEDULE_ENABLED=false`, `INGESTION_WRITES_ENABLED=false`, and `GENERATION_ENABLED=false` are independent defaults. Both ingestion flags must be explicitly enabled for scheduling mutations. Resource IDs are unprovisioned, workers.dev/preview URLs are disabled, and explicit staging/production environments also use unprovisioned IDs and disabled flags. Provisioning, secrets and cutover remain later deployment work.

The hourly UTC dispatcher evaluates America/Chicago from 07:00 to midnight, schedules only today's date, and never backfills earlier dates automatically. D1 permanently enforces unique(source,chicago_date). Run and outbox insertions are transactional. IDs are deterministic and under 100 characters. Workflow retention does not remove uniqueness. Each source dispatches independently. Outbox attempts use a one-minute lease, compare-and-swap attempt count, five bounded attempts, and exponential delay. After an ambiguous create response, get/status checks the same ID. A delivered outbox means creation acknowledgement, not source success.

## Source contracts and durable progress

- Greenhouse independently captures each board with content=true, checking meta.total, row schema, and unique IDs. Only a complete board snapshot may close its source-owned jobs.
- Fantastic uses the existing 24h window and limit=50 with offset until a short page. It remains a rolling feed; absence never closes jobs.
- Jobven uses limit=25, descriptionFormat=plain and the configured skills list. It reads descriptionPlain and follows nextCursor until hasMore=false, rejecting missing/repeated/contradictory cursors and count mismatches. Optional URLs stay optional. Its filtered/rolling absence never closes jobs.

Fetch/body timeout is 20 seconds, response bound 16 MiB, with at most three attempts for 429/500/502/503/504, timeout or network failure. Redirects are refused. Credentials, response error bodies, headers and opaque cursor contents are never logged. Every successfully fetched response is archived by SHA-256 in private R2 with source/capture/checksum metadata. Malformed JSON/schema retains raw evidence and a redacted disposition. An oversized/timed-out body cannot be a complete capture; earlier pages and cursor remain durable.

D1 records each raw page and normalized backlog. Steps stage at most 25 rows or import at most 10 records. Each record atomically updates job/source/version/audit/action count/backlog. Optimistic guards roll back conflicts. Workflow results contain tiny progress metadata, never raw pages. Page limit is 200 per retry revision and Workflow limit is 10,000 steps; exhaustion fails incomplete with backlog/cursor retained. Up to five explicit retry revisions expand the page allowance by 200 each. A normalized record over 200,000 UTF-8 bytes is rejected instead of truncated. There is no 40-record cap.

Versions contain `{core,externalId,canonicalUrl,salary,tags,locations,companies,provenance,sourceFields}`; core matches the app's job columns. All fields participate in changes, including descriptions. Full source descriptions, all source fields/locations/companies, and salary currency/period are retained. No annualization or default Mid/Full-time inference is applied. Heuristics and provider AI carry provenance. Greenhouse HTML is converted to readable plain text by the inert HTML5 parse5 parser (paragraph/list breaks, entity decoding, scripts/styles excluded); exact original HTML remains in sourceFields and R2. Conversion rejects over 200,000 source bytes or 50,000 traversal items instead of truncating. Saved notes, profiles and drafts are untouched. Observation freshness uses complete validated captures/import, not scheduler invocation. Closure review records successful observation separately from pending closure decisions. See [synthetic legacy comparison](../fixtures/ingestion/legacy-normalization.json).

## Identity and closure

Identity is (source,external_id), including Greenhouse board. All existing softr-legacy aliases and original URLs remain. Automatic reuse requires exactly one job matching the exact job-specific canonical HTTPS URL; meaningful query IDs are preserved. Generic or ambiguous URLs stay separate with a review disposition. Title/company never establish identity. New exact URLs have deterministic hash-derived IDs. The first committed source owner is recorded once; alternate sources retain observations but cannot overwrite its canonical content. Canonical ownership changes require a separately reviewed operation.

Closure requires a complete, validated and fully imported Greenhouse board, and is scoped to its source-owned jobs. Empty boards, rejected rows, partial pages, malformed responses, rolling absence and exhausted bounds never close jobs. Defaults permit no more than 25 removals and 10% of tracked open board rows; configuration can tighten these limits. Larger/empty removals produce review state. Saved references remain intact and closed jobs remain readable. Jobven explicit closed/expired status can close its own source-owned job.

## Local commands

```powershell
pnpm typecheck
pnpm test:ingestion
pnpm build:jobs
pnpm cf:types:jobs
pnpm ingestion:shadow --snapshots C:/protected/greenhouse-20260911 --local-store C:/protected/shadow-1 --date 2026-09-11 --captured-at 2026-09-11T12:35:10Z --create
pnpm ingestion:shadow --snapshots C:/protected/greenhouse-20260911 --local-store C:/protected/shadow-1 --date 2026-09-11 --captured-at 2026-09-11T12:35:10Z
pnpm ingestion:inspect C:/protected/shadow-1 ingest-greenhouse-anthropic-2026-09-11
```

Snapshots are anthropic.json, stripe.json, figma.json. Inputs/output must resolve outside the repository. --create refuses existing directories and applies owner-only Windows ACLs. Repeat openings require exact local marker/config and immutable migration checksums; they do not change pre-existing directory permissions. A temporary bundled Miniflare harness is written outside the repository and executes beside native D1, with only local resources, no env files, no credentials, a denied outbound service and a network-refusing provider fetcher. It binds an ephemeral loopback port, never the application preview port, and is disposed after the CLI invocation. The harness is excluded from deployable Workers. The store is separate from the application preview. Reports expose aggregate source hashes/counts/completeness/actions/normalization differences and explicit provider entitlement/live acceptance gates. Same date+bytes reuses the run and yields zero new versions; a new observation uses a new date, never overwrites successful date uniqueness. The aggregate report includes the final bundled harness hash; only small control/result messages cross the Node/Worker boundary.

## Trusted operator recovery

Cloudflare-authenticated tooling can inspect a provisioned Workflow with `wrangler workflows instances describe <workflow-name> <workflow-id>`, together with redacted D1 run/outbox state. Local CLI inspection above is the runnable path before provisioning. No application identity grants operator access.

Service functions in workers/jobs/src/dispatcher.ts form the trusted-tooling interface: inspectRun(db,runId), retryRun(env,workflow,runId,expectedRevision), recoverRestart(env,workflow,runId,expectedRevision), retryDispatch(env,runId,expectedRevision). Never mount these on user routes. Retry requires failed state, matching bounded revision and a stopped Workflow, refuses a superseded observation, audits intent, and restarts the same ID/backlog. An ambiguous response leaves restart_pending/restart_unconfirmed; recoverRestart checks status and reuses the same audited revision. retryDispatch validates an exhausted outbox and audits its revision before reopening bounded attempts. Successful runs and closure reviews cannot be silently retried. Immutable malformed/rejected evidence needs a reviewed normalizer correction or a subsequent source/date; repeating unchanged bad evidence fails again.

For generation, reserve a separate outbox kind and Workflow binding: drainOutbox consumes only ingest-source. IngestParams is `{runId:string}`. GENERATION_ENABLED stays false; generation is not implemented in this task.

## Official references

- [Workflows rules](https://developers.cloudflare.com/workflows/build/rules-of-workflows/) and [trigger Workflows](https://developers.cloudflare.com/workflows/build/trigger-workflows/)
- [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/), Wrangler 4.131.0 generated runtime types and installed config schema
- [Greenhouse Job Board API](https://docs.greenhouse.io/job-board.html)
- [Fantastic pagination](https://developer.fantastic.jobs/documentation/endpoints/new-jobs) and [parameter schema](https://developer.fantastic.jobs/api/new-jobs): narrative recommends 100–1,000, schema permits 1–1,000, so existing limit 50 is retained
- [Jobven Jobs API](https://jobven.com/docs/reference/jobs) and [data types](https://jobven.com/docs/reference/data-types): plain mode uses descriptionPlain, URLs may be absent and salary periods include hour/year

- [parse5 parseFragment API](https://parse5.js.org/functions/parse5.parseFragment.html); pinned parse5 8.0.1. The local harness uses the installed Miniflare 5 converter API and esbuild 0.28.1, matching Wrangler's dependencies.
