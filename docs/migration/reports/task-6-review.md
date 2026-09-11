# Task 6 independent review — changes required

Reviewed the Task 6 brief, report, isolated 26-file patch, actual generation implementation, shared profile/draft/status contracts, native tests, browser test, configuration/types and runbook. Prior phases 1–5 are outside this review except their integration contracts. Two material P2 findings remain; no P0/P1 finding was identified in the inspected scope.

## P2 — First-generation drafts still cannot save edits while queued

**Location:** `apps/web/src/routes/saved.tsx:170–173`; corresponding new-draft creation in `packages/data/src/generation.ts:196–199` and the generation exception in `packages/data/src/services.ts:502–505`.

**Trigger and impact:** A user requests a draft for a saved job that has no existing draft. Acceptance creates a generation-provenance draft with `execution_status='queued'`. After the editor loads, typing a cover letter makes it dirty, but “Save draft edits” remains disabled because its status condition unconditionally blocks queued/running drafts. The API now deliberately permits this exact operation and would preserve the edit through the finalization revision guard. The UI prevents that protection from being used. A queued request can remain undispatched while the independently controlled background flag is disabled, so this can block saving for an indefinite period. This contradicts the required editable-pending lifecycle and the report's claim about new drafts.

**Verified evidence:** An AST extraction evaluated the actual button's disabled expression with `busy=false`, `dirty=true`, and `{executionStatus:'queued', provenance:'generation'}` and returned `true`. The selected native edit-during-provider test passed, establishing that the service supports the intended operation. `tests/e2e/generation.spec.ts` exercises regeneration of an already existing synthetic draft and retains unsaved text; it never covers saving edits to the newly created queued draft.

**Scoped remedy:** Match the UI's execution-status restriction to the service's generation-provenance exception. Add a focused browser case starting with no draft: request, type, save while still queued, reload, then establish that subsequent generation cannot replace the saved revision. Preserve explicit approval checks and the restrictions for unrelated legacy execution states.

## P2 — Requests with no selectable evidence are accepted despite guaranteed output failure

**Location:** `packages/domain/src/generation.ts:60–75`, contrasted with `packages/domain/src/generation.ts:130–132` and `workers/jobs/src/anthropic.ts:36`.

**Trigger and impact:** A valid fresh profile contains only a summary of 6,001 characters (or only experience/education entries exceeding 6,000). `buildSnapshot` accepts the full field as one evidence item and requires merely a nonempty evidence array. The request service proceeds to durable acceptance and the provider call. However, the provider contract requires at least one evidence ID and the local renderer rejects every ID whose complete text exceeds 6,000 characters. This request has no successful possible response: the only known ID is rejected, an empty list is rejected, and invented IDs are rejected. The user loses an accepted-request quota slot and may incur provider cost for a deterministic failure, reported as unsupported provider output rather than an actionable profile-input problem.

**Verified evidence:** Bundled the actual domain module in memory with installed esbuild, then called `buildSnapshot(JSON.stringify({summary:'A'.repeat(6001)}), JSON.stringify({title:'Engineer'}))`. It succeeded with one 6,001-character evidence item. `renderOutput({evidenceIds:['profile.summary']}, snapshot)` then threw `provider_output_unsupported`. The existing profile schema allows this summary length, and snapshot bytes remain well below 96,000. This is independent of live model quality or entitlement.

**Scoped remedy:** Validate that at least one item can satisfy the selected output contract before accepting the request. For the existing whole-field contract, reject zero eligible evidence with an actionable message to shorten/add an evidence field. Retain the output validation. Test the boundary and verify that this rejection creates no request, draft, outbox event or provider attempt. A new segmentation strategy is optional and would require its own explicit evidence contract; it is unnecessary to fix this defect.

## Focused validation and inspected guarantees

Ran:

```text
pnpm exec vitest run --config vitest.jobs.config.ts tests/jobs/generation.test.ts -t 'generation atomic idempotency|user edits while provider runs|approval wins|R2 response write response loss|durable rolling|real GenerateDraftWorkflow'
```

Result: **6 passed, 29 skipped**, one file; 4.80 seconds reported by Vitest. These native D1/R2 tests cover same-intent concurrency, edit/approval races, the actual Workflow wrapper with a mocked fixed endpoint, lost R2 response-write acknowledgment and limits across different saved jobs. I inspected the remaining fixture assertions and source paths rather than rerunning the already-passed broad suites. AST/domain counterexamples above ran locally through Node/TypeScript/esbuild with no external request and no source/test modification.

Inspected acceptance transactions, composite owner relationships, exact immutable version selection, resume rejection, allowlisted snapshots, R2 hash recovery, deterministic dispatch, recorded attempts before provider calls, bounded 429-only retry, ambiguous-acceptance termination, persistence before finalization, atomic finalization guards, status-only saved-summary updates, output schema/evidence restrictions and owner-only status responses. No additional material defect was confirmed in those paths. The fixed quotation-based letter is the accepted conservative design; free-form generation is not a missing feature.

Staging and production each explicitly declare `send_email`/`EMAIL` restricted to `no-reply@auth.lakefrontdev.com`, with matching `MAIL_FROM`. Installed Wrangler schema includes `allowed_sender_addresses`; generated environment/runtime types and the existing structured `EMAIL.send()` call are consistent. `MAIL_MODE` remains disabled; local has no email binding. App/background generation and other release switches remain false in checked configurations. Sender DNS and attachment evidence are parent-owned and not independently asserted here.

## Limits

No implementation/test edits, Git staging/commit/deploy, provider/mail calls, credential/private-archive reads, remote provisioning, subagents or stable-preview changes. No new browser session was run for this review; the UI finding is established from the actual rendered-button condition and the persisted-state/service contracts, not presented as a browser observation. Live Anthropic model access, real provider output quality/human evaluation, deployed Workflow restart/billing behavior and release enablement remain explicit gates. Ordinary fresh Better Auth email/password accounts remain binding; no Auth0, account migration, claiming or email linking is requested.
