# Spec compliance: both findings ADDRESSED

- **ADDRESSED — transient session failures discarded unsaved forms.** `apps/web/src/main.tsx:45` now records a recoverable failure while keeping the editor mounted; successful revalidation clears the notice. `apps/web/src/api.ts:103` redirects only for a confirmed HTTP 401 and checks that status before parsing JSON. `tests/e2e/review-fixes.spec.ts:18` verifies retained profile text through an HTML 503, retained saved-job/draft text through a network failure, and successful recovery. `tests/e2e/review-fixes.spec.ts:71` separately verifies that real Better Auth sign-out followed by an actual 401 removes private content.
- **ADDRESSED — query IDs overrode canonical path IDs.** `apps/web/src/main.tsx:79` reads `recordId` exclusively for legacy detail routes; canonical routes use their path segment. `tests/e2e/review-fixes.spec.ts:99` verifies conflicting IDs, the displayed job/source link, mutation persistence only on the canonical saved row, and continued legacy-route behavior.
- **Direct new breakage: none found in the fix.** The added retry state preserves component identity. The local port override keeps the default preview at 8787 and supplies the matching Worker origin for the isolated regression run (`tests/e2e/preview.mjs:11`, `tests/e2e/preview.mjs:114`).

# Task quality: Approved for this correction

- Check performed: read the fix patch and the appended Fix round 1 report. The regression assertions cover the reported failure modes and real unauthorized behavior. Accepted the reported two failing regressions before the fix, three focused Playwright passes after it, and passing lint/typechecks/build. No test reruns, external calls, broader review, source/index edits, or subagents; only this review artifact was written.
- Scope remains task 4 and these two corrections. Previously recorded cross-task and live-production acceptance limits remain unchanged.
