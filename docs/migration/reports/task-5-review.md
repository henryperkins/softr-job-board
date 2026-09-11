# Task 5 independent review

**Result: CHANGES REQUIRED — two Important findings.** No Critical findings.

Reviewed the Task 5 brief, report, bounded patch, provider/ingestion/dispatcher/Workflow implementation, additive schema, tests, local-shadow tools, configuration and generated binding declarations. Account migration and claiming are excluded; regular Better Auth email/password remains the accepted scope. No legacy-claim gate applies. No unrelated UI/auth changes were reviewed.

## Important: an older run can close a job observed by a newer importing run

Evidence: `workers/jobs/src/ingestion.ts:409` selects closure candidates using `s.observed_run_id != run.id`. The final transaction's source guard at line 404 considers only completed source observations. Its per-job guard at line 472 checks job revision but not source observation freshness; lines 477 and 498 then close the job and source row.

A newer complete capture can already have imported a record while its final source-observation transaction has not run. An older run that finishes in this interval treats that newer observation as absence. This both permits stale closure and can misclassify records that were present in the older run, because the mutable last-observed run ID is not immutable membership evidence.

Confirmed against native local D1/R2 using the unchanged ingestion engine: baseline has 20 open Stripe jobs; September 2 captures/imports jobs 1–19 and pauses before finish; September 3 captures/imports job 0 and pauses before finish. Finishing September 2 closes job 0 even though its source row still says `observed_at=2026-09-03T12:00:00Z` and `observed_run_id=ingest-greenhouse-stripe-2026-09-03`. The 1/20 removal passes the default closure circuit breaker. Before status was Open; afterward it was Closed. The same issue is reachable when a new daily workflow overlaps an older interrupted/recovered workflow.

Scoped remedy: determine absence from the finishing run's immutable backlog membership, and refuse or exclude source observations newer than that run's capture timestamp. Enforce freshness and membership again within the closure transaction so concurrent imports between the selection and batch cannot bypass the check; a job revision check alone does not protect unchanged newer observations. Add one native regression for overlapping runs where the newer run has imported but has not called finish, including an unchanged newer observation.

## Important: generic listing URLs merge unrelated provider identities

Evidence: `workers/jobs/src/providers.ts:117–120` considers any path segment after jobs/positions/postings/requisitions job-specific, including `https://example.com/jobs/search` and `/jobs/all`. `workers/jobs/src/ingestion.ts:237–248` then reuses the one URL match or derives one shared URL-based ID. This defeats the brief's requirement that generic URLs preserve separate jobs and produce a review disposition.

Confirmed first by invoking canonicalJobUrl directly and then with native ingestion: two distinct Figma external IDs with the URL `https://synthetic.test/jobs/search` produce **two aliases, one shared job, and zero identity reviews**. Stable first-owner behavior then prevents the second posting's canonical content from being displayed. This is silent conflation/loss of a distinct listing, despite no title/company deduplication.

Scoped remedy: accept automatic URL reuse only for demonstrably job-specific patterns (such as supported provider job identifiers, UUID/numeric identifiers, or explicit requisition query IDs), and conservatively reject generic search/list/category paths. Unproven URL shapes should retain source/external identity and receive the existing nonmerge review disposition. Add focused cases for `/jobs/search`, `/jobs/all`, a category path, and legitimate Greenhouse/external-ID URLs.

## Validation and boundaries

- Reproducer: `.superpowers/sdd/softr-cloudflare-migration-plan-2026-09-11/task-5-review-repro.mjs`; run with `node` from the repository root. It is ignored review scratch, not an implementation/test change.
- Native synthetic store created exclusively for this review: `C:/Users/htper/Documents/Codex/2026-09-11/files-mentioned-by-the-user-softr/work/ingestion-review-synthetic-1789135071551`. The runtime was disposed. Provider network is forbidden by the existing shadow harness. The store contains synthetic jobs only.
- Actual result: `before.status=Open`, `after.status=Closed`, both retaining the newer September 3 observation; generic URL result `aliases=2,jobs=1,reviews=[]`.
- Existing 21-test ingestion suite was read; its stale-run regression covers a newer run that has already completed, so it does not cover the first finding. Its generic-URL case uses `/careers`, so it does not cover the second finding. Broad already-passed suites were not redundantly rerun.
- Installed Workflow type declarations and native local APIs were inspected. Binding configurations remain disabled and unprovisioned. No implementation/tests were edited; no staging, commits, deploys, live providers, private exports, or stable localhost:8787 preview were touched.
- Controller's independent aggregate legacy shadow evidence (174 exact-URL reuses, 1,202 creates, all 295 legacy IDs retained, zero FK violations) and the implementer's accepted persistent 1,376-create / 1,376-unchanged evidence are compatible with these findings: neither exercised the two counterexamples above. Superseded ephemeral/partial shadow stores were not used as acceptance evidence.

Task 5 should receive a focused correction and re-review of these two behaviors before acceptance. No unrelated scope expansion is requested.
