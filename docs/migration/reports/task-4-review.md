# Spec Compliance

- ❌ Issues found: canonical details can display a record other than the path-selected record (`apps/web/src/main.tsx:66`); background session verification also discards unsaved edits on recoverable request failures (`apps/web/src/main.tsx:34`). Both require fixes before task acceptance.
- ✅ The scoped implementation covers email/password UI, actual API persistence, explicit active profiles, retained revisions, owned file quarantine, saved pagination, review/approval controls, and compiled asset routing. Evidence: `apps/web/src/routes/auth.tsx:38`, `apps/web/src/routes/profiles.tsx:318`, `packages/data/src/services.ts:225`, `packages/data/src/user-flows.ts:89`, `packages/data/src/services.ts:350`, `apps/web/src/routes/saved.tsx:44`, `workers/app/src/index.ts:357`.
- ⚠️ Cannot verify from this isolated diff: the unchanged job serializer's source-URL sanitization and source-content mapping, the complete existing draft approval/download authorization implementation, and migration consumers of the new active-version column. The controller should retain the reviewed foundation evidence and check these contracts when the consuming tasks are reviewed. No additional repository crawl was performed. Production/email/scanner/native Softr gates are explicitly pending, not missing task-4 claims.

# Strengths

- `packages/data/src/user-flows.ts:95`: uploads check owner, archive state, revision, actual size and byte signature before storing; private keys are generated server-side and include the owner/profile/version. The D1 batch writes content, attachment metadata, immutable version and audit together. Its catch path checks for committed metadata before deleting only this request's key (`packages/data/src/user-flows.ts:173`), appropriately retaining an object when the commit response is ambiguous.
- `packages/data/src/services.ts:203`: ordinary profile edits merge validated mutable content into retained JSON, preserving server-managed attachment IDs. `packages/domain/src/contracts.ts:17` uses a strict mutable-field schema, preventing clients from replacing those references directly. Archive/restore retains history and clears an archived active choice (`packages/data/src/user-flows.ts:33`).
- `packages/data/src/services.ts:371`: saved pagination uses immutable creation time plus ID, joins real job labels, and keeps counts across all owned rows. The integration test actually traverses 505 entries without duplicates (`tests/integration/user-flows.test.ts:138`).
- `apps/web/src/routes/saved.tsx:138`: approval requires saved reviewable content and an explicit action; conflicts retain the editor state, while immutable review history remains readable. `tests/e2e/core.spec.ts:284` exercises stale draft text, approval, and keyboard status persistence against the actual local Worker.
- `tests/e2e/preview.mjs:21`: the harness applies migrations and seeds only isolated local storage, with no runtime authentication bypass. Reported tests and the controller's independent render findings provide relevant synthetic evidence without claiming live acceptance.

# Issues

## Critical

- None found in the scoped change.

## Important

- **[P2] Preserve drafts through transient session-check failures — `apps/web/src/main.tsx:34`.** Every failed background `/api/session` request calls `loginRedirect()`, including offline/network failures, malformed gateway responses, and HTTP 500/503. This runs on focus and every 30 seconds (`apps/web/src/main.tsx:40`). `loginRedirect()` empties the React root and navigates away (`apps/web/src/api.ts:77`), destroying unsaved profile, saved-job, or draft text even though authentication has not been shown to expire. Redirect only for a confirmed unauthorized session; on indeterminate failures retain the editor state, show a retry state, and, if desired, temporarily mask private content without destroying it. Add a focused browser case with a populated unsaved editor and a failed session heartbeat, followed by recovery; separately retain the expired-session masking check.
- **[P2] Canonical detail paths must determine the selected record — `apps/web/src/main.tsx:66`.** `recordId` takes precedence on every page, so `/jobs/A?recordId=B` validates A in the Worker but fetches and renders B in React; `/saved-jobs/A?recordId=B` has the same mismatch. Saving or editing consequently operates on B while the canonical URL names A, violating the exact-selected-record requirement. Read the query parameter only for the two legacy detail routes and read the path segment for canonical routes. Add focused cases with two distinct synthetic records and conflicting path/query IDs for both detail types.

## Minor

- None requiring a separate finding.

# Assessment

**Task quality: Needs fixes.** Ownership, persistence, upload atomicity, and synthetic acceptance coverage are strong, but the automatic loss of unsaved work and canonical record mismatch are concrete user-facing correctness defects.

- Check performed: reviewed the supplied isolated patch; the initial tool output truncated, so omitted sections were recovered in bounded slices, without Git commands. One narrowly scoped source check completed the cut-off `editProfile` function and its mutable schema to resolve the named attachment-preservation risk (`packages/data/src/services.ts:190`, `packages/domain/src/contracts.ts:17`). No code/index edits, subagents, private-source reads, external calls, or test reruns. Existing 30 integration, 29 unit, 8 E2E and separate viewport evidence were accepted as reported; LF/CRLF warnings were treated as environment metadata. Only this requested review artifact was written.
