# Task 6 fix round 1 independent review — PASS

Both P2 findings in `task-6-review.md` are resolved. No remaining material finding was identified within this correction scope. Read the fix report, isolated fix patch and all six actual changed paths, then checked the corresponding unchanged shared-service and acceptance boundaries. This is a scoped Phase 6 correction review, not a new broad review or Phase 7 work.

## First-generation queued editing

`apps/web/src/routes/saved.tsx:170–175` now permits a dirty generation-provenance draft to be saved while queued/running, matching `DataService.editDraft`. Busy/clean restrictions and queued/running restrictions for other provenance remain. Approval conditions were not relaxed. The shared service still increments the saved draft revision and changes pending generation draft execution status to cancelled; existing finalization guards protect that revision from replacement.

Independently extracted the actual JSX Save button condition with the installed TypeScript parser and evaluated eight cases: queued/running generation drafts with dirty text are enabled, while legacy provenance, busy state and clean text remain disabled. All eight assertions passed. Inspected the new browser test in `tests/e2e/generation.spec.ts`: it begins with no draft, accepts a new request through the actual local app, saves typed text while queued, reloads, and checks persisted revision 2/cancelled/unapproved against request expected revision 1. Its reported successful browser run was not repeated for this review. The independently rerun native edit/finalization race supplies the completion-side protection evidence.

## Evidence eligibility before acceptance

`packages/domain/src/generation.ts:61–85` applies the same 6,000-character bound used by `renderOutput` before returning the snapshot. Oversized whole fields are excluded without truncation or segmentation; a profile left with zero eligible evidence gets `profile_evidence_too_long`, while genuinely absent evidence retains `profile_evidence_required`. Skill item lengths are already bounded below this threshold by the existing profile schema. Mixed profiles retain eligible exact evidence and receive explicit omission explanations in the review gaps. The API error text provides a concrete shorten/add-evidence recovery path.

`GenerationService.request` builds this snapshot before its acceptance batch. Thus the new rejection precedes quota-consuming request creation, draft/version creation, outbox/audit writes and snapshot manifests; no request exists for a dispatcher/provider to execute. The native boundary test verifies those zero mutations and unchanged saved summary, then successfully accepts 6,000 characters under a one-request daily quota. The mixed-profile test verifies omitted text never enters the mocked provider input, the original immutable profile JSON and source hash are retained, valid output succeeds, and an omitted evidence ID remains invalid. Existing pending snapshots are not rewritten; immutable-byte hash checks remain unchanged.

## Independent focused evidence

Ran:

```text
pnpm exec vitest run --config vitest.jobs.config.ts tests/jobs/generation.test.ts -t 'whole-field evidence|user edits while provider runs|approval wins'
```

Result: **4 passed, 33 skipped**, one file; Vitest duration **5.71 seconds**. These cover the two new evidence tests plus edit-during-provider and approval/regeneration guards. Also ran the eight actual-source JSX condition assertions described above. No broad suite, browser harness or build repetition was needed after these focused checks.

## Boundaries and remaining gates

No implementation/test edits, staging/commit/deploy, provider/mail calls, credential/private-archive reads, remote operations, subagents or stable-preview changes were made in this review. Only this review report was written. Fresh Better Auth email/password ownership, explicit approval, immutable provenance, provider/model restrictions and disabled release configuration remain unchanged by the six-file correction. Live provider entitlement, human evaluation, deployment/restart/billing behavior and release enablement remain separate gates; this PASS does not satisfy them. Phase 7 was not started. Stop for the parent handoff.
