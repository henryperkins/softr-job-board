# Task 6 fix round 1 — ready for scoped re-review

Fixed only the two accepted P2 findings from task-6-review.md. Six implementation/test/doc files are changed, all unstaged. No changes to schema, source hashes, provider/model/prompt contract, auth/mail/infra configuration, dependencies, parent-owned handoff/progress artifacts or Task7. No staging, commits, provider/mail calls, private archive reads, remote actions or subagents.

## Corrections

1. The Save draft edits button now uses the same provenance exception as the reviewed shared service: queued/running execution prevents saving only when provenance is not generation. Busy/clean-editor restrictions stay in place. Approval conditions and legacy execution restrictions are untouched.
2. The existing whole-field evidence contract is enforced before request acceptance. Trimmed fields exceeding 6,000 characters are excluded from provider-selectable evidence; they are never truncated or segmented. Mixed profiles use eligible exact evidence and explicitly list omitted fields in review gaps. If the excluded fields leave no eligible evidence, profile_evidence_too_long fails with actionable UI text to shorten a field or add concise evidence and choose the new profile version. Completely absent evidence keeps its existing profile_evidence_required error. The renderer retains the same strict bound via a shared constant.

The original immutable profile content and profile-version hash remain intact. Only the allowlisted snapshot/provider input excludes ineligible fields. No existing request or immutable snapshot is rewritten. A pre-fix local pending request that included an oversized field cannot silently adopt changed snapshot bytes: its existing hash guard fails closed. Nothing has been deployed or enabled.

## Red-to-green evidence

Native red command:

```text
pnpm exec vitest run --config vitest.jobs.config.ts tests/jobs/generation.test.ts -t 'whole-field evidence'
```

Result: **2 failed /35 skipped**. The 6,001-only profile incorrectly returned queued acceptance, and the mixed profile retained its oversized summary in selectable evidence.

Native green command:

```text
pnpm exec vitest run --config vitest.jobs.config.ts tests/jobs/generation.test.ts -t 'whole-field evidence|user edits while provider runs|approval wins'
```

Result: **4 passed /33 skipped**,4.04seconds total. The two new tests establish:

- 6,001 characters rejects before request, attempt, draft, draft version, outbox, input manifest, snapshot state, audit or saved-summary mutation.
- A following 6,000-character profile can still use a one-request quota slot, proving the rejected request did not consume it.
- Exactly6,000 characters remain intact and render successfully.
- A mixed6,001-character summary and eligible skill sends only the skill to the mocked provider, shows an explicit6,000-character omission explanation, and succeeds without truncating or changing the stored source profile/hash.
- An excluded ID still fails strict output validation.

The two existing race tests remain green: a first-generation draft edited while the provider runs cannot be overwritten at completion, and approval wins a regeneration race. No shared-service/finalization change was necessary.

Browser red and green command (PowerShell):

```powershell
$env:SYNTHETIC_PORT='8898'
$env:SYNTHETIC_GENERATION='true'
pnpm exec playwright test tests/e2e/generation.spec.ts -g 'first-generation queued'
```

Port8898 and inspector9898 were confirmed unused before the first run. Both runs used fresh local harness stores; the stable8787 preview was not restarted.

- Red: **1 failed** at the actual rendered Save draft edits button, which remained disabled after typing into a new queued generation draft.
- Green: **1 passed**,15.9seconds overall/1.6seconds test.
- The case starts with a saved job with no draft, requests generation, types a cover letter, confirms approval is disabled before saving, saves while the request remains queued, reloads and verifies the text persists. The pending request still expects revision1, while the saved draft is revision2/cancelled/unapproved. Existing native finalization-race evidence above proves the later generated output cannot replace that saved revision.
- No background/provider execution or intercepted response is used in this new browser case. The browser uses actual local app/D1 acceptance/edit persistence. Live model completion remains outside the test.

## Affected checks

- pnpm lint: passed.
- pnpm typecheck: passed app and background TypeScript projects.
- pnpm typecheck:web: passed.
- Prettier formatted all six changed supported files.
- git diff --check: passed (only normal LF→CRLF notices).
- Browser harness performed the real Vite production web build successfully.
- Final localhost8787/login check returned HTTP200.

The previously passed full35-generation/31-integration suites were not broadly repeated; this scoped pass selects the affected boundary and race contracts. Generation test inventory is now37; the browser generation file now has two cases, of which only the new focused case was run here.

## Changed files

1. apps/web/src/api.ts
2. apps/web/src/routes/saved.tsx
3. docs/generation.md
4. packages/domain/src/generation.ts
5. tests/e2e/generation.spec.ts
6. tests/jobs/generation.test.ts

Final scoped diff:204insertions,4deletions across these6files. This ignored report is the handoff artifact. Provider access, live human model evaluation, resume extraction and all release gates remain unchanged. Stopped for parent re-review; do not begin Task7.

