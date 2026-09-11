# Task 4 implementation report — 2026-09-11

## Outcome and boundaries

Implemented the React 19/Vite interface and remaining core user persistence against the real Worker/D1/Better Auth foundation. Local synthetic API and browser acceptance passes. This is not a native Softr parity, staging email, deployed production, migration activation, malware scanning, ingestion, generation or MCP acceptance claim.

No subagents, CUA actions, private-source reads, commits, pushes, deployments, email sends, or external application writes occurred. The parent-owned migration scripts/docs/fixtures and migrations 0002/0004 were preserved. The one existing security assertion changed only from `/login` to `/login?next-page=%2Fprofile`, matching the newly required safe return destination. No existing migration unit test was edited.

## Stable synthetic preview for the controller

- URL: **http://localhost:8787/login**. Use `localhost`, not `127.0.0.1`, because the trusted Origin is exact.
- Hidden local harness Node PID: **13776**; it owns a local Wrangler child. The last readiness probe returned HTTP 200.
- Current isolated D1/R2 persistence directory: `.wrangler/e2e-mtwyoh7f` under this repo. This preview was freshly seeded after the full interaction run; only the subsequent read-only viewport sweep has used it.
- Authoritative synthetic sign-in source: `tests/e2e/synthetic-accounts.mjs`. A is `candidate-a@example.test`, B is `candidate-b@example.test`; both use the explicitly public test password `Synthetic-preview-only-123!`.
- A starts with Test Candidate A, an explicit active profile/version, one saved Senior AI Engineer role and a legacy Ready for Review draft. B starts empty and `/` redirects to onboarding. There are 32 synthetic open jobs.
- Reproduce from the repo: `pnpm install --frozen-lockfile`, `pnpm exec playwright install chromium`, then **`pnpm preview:synthetic`**. This builds the frontend, applies every numeric D1 migration locally, hashes synthetic passwords through Better Auth, seeds two isolated verified test accounts, and starts the actual Worker. There is no production bypass endpoint or runtime seed import.
- Every new harness start uses a fresh short `.wrangler/e2e-*` path. The first longer UUID path hit a Windows/workerd filesystem error; shortening the generated local directory resolved it. Existing fixture runs are retained, not recursively removed. In-server reloads and independent sessions share committed D1 state.
- Logs: `C:/Users/htper/Documents/Codex/2026-09-11/files-mentioned-by-the-user-softr/work/task-4-browser/preview.stdout.log` and `preview.stderr.log`.

## User-visible implementation

- Auth: branded Welcome back login; sign-up, forgot-password, reset-password and expired-link pages; same-origin allowlisted next-page handling; truthful 202 request receipt wording; friendly globally disabled-mail error. Business state remains inaccessible without verified authentication. Account name changes and current-password-verified password changes with other-session revocation are implemented. No unverified source identity is claimed by email, and no unverified native account deletion/email-change behavior was invented.
- Dashboard: real owned counts, status columns with explicit native select and Update status button, real job title/company, latest draft summaries and real metadata activity. Counts cover the entire owner set; paginated rows continue beyond the former 500 cap. Status changes do not rely on dragging.
- Jobs: source information architecture and compact rows, Open roles heading, title/company search, exact server-supplied workplace/employment/seniority options, Open-only UI query, stable next/previous pages, loading/empty/error/retry states. Canonical and legacy details resolve the exact record. Description source text is rendered as text, including inert script-like strings. HTTP(S) source links say View application on source site and explicitly do not imply submission.
- Saving: owner-specific current-save lookup, idempotent save operation and direct owned saved-job link. Saved detail persists notes/priority/status/outcome/submission URL and preserves unsaved text on stale revision errors.
- Profiles/onboarding: create/edit, all foundation mutable fields, multiple profiles, explicit active choice/version, persistent selection, revision-aware edits, reversible archive/restore and private file upload/listing. No arbitrary initial active choice, personal location, membership date or invented activity is introduced. Onboarding retries can use an owner-scoped idempotency key to return the original persisted profile.
- Drafts: latest and earlier owned draft selection, immutable review history, edits and explicit approval using expectedRevision; approval is disabled for unsaved edits and does not submit an application. Prior approved content survives conflicts. Generation is visibly unavailable with no success button.
- Files: owned PDF/JPEG/PNG/WebP only, 8 MiB maximum, byte-signature/MIME agreement, SHA-256 checksum, unique versioned private R2 keys. Upload creates an immutable profile version containing an explicit attachment ID and persists revision, attachment metadata and audit atomically in D1. Failed DB writes only clean this request's newly-created orphan key after checking for committed metadata. Files remain pending/quarantined and downloads unavailable until real clean scanning exists.
- Navigation/privacy: compiled hashed JS/CSS assets are served through the exact assets prefix; reserved API/auth/MCP/metadata routes never fall through to HTML. Unknown legacy detail IDs return HTTP 404. Protected/index responses are no-store/noindex with CSP. Full page navigation, pagehide masking and session rechecks prevent logout/back from exposing old private content. No private localStorage or Service Worker is used.

The source jobs/profile TSX references informed the route labels, lightweight row/card treatment and useful fields. Fixed location, false save toast, invented activity and dummy apply links were removed. This is a presentation port, not a new visual design concept. The observed login scale/colors and Inter/system typography are retained without external font/image requests.

## Additive schema and API changes

`0003_user_flows.sql` adds nullable `archived_at` on profile roots/versions, `active_profiles.profile_version_id` with owner/reference validation triggers, active-version synchronization when the selected profile gets a new version, and owner-scoped `profile_create_requests` for retry idempotency. Historical roots/versions/references remain intact. The existing explicit profile choice is backfilled to its latest retained version; no new choice is inferred. Parent 0004 remains independent.

All new APIs inherit verified-session ownership, exact-Origin CSRF enforcement, writes flag checks and no-store headers:

| Endpoint | Contract |
|---|---|
| `GET /api/job-options` | `{remote:string[],employment:string[],seniority:string[]}` with exact distinct stored choices. |
| `GET /api/jobs` | Existing filters plus optional `status=Open|Closed`; the UI sends Open. Existing default API behavior remains available to later callers. |
| `GET /api/jobs/:id/save-state` | Internal or legacy job lookup; `{savedJobId:string|null}` scoped to the caller. |
| `GET /api/saved-jobs?limit=&cursor=` | `{items,nextCursor}`. Default25/max100; descending immutable `(created_at,id)` continuation so ordinary edits do not reorder pages. Each saved item adds `job:{title,company}` using a join. |
| `GET /api/dashboard?limit=&cursor=` | Existing shape plus `nextCursor`; real totals cover all owned saves, active profile count excludes archived roots. |
| `POST /api/profiles` | Existing input plus optional `idempotencyKey` (1–100 characters); same owner's replay returns the originally committed profile without new versions/audits. Frontend uses one random key for each create form. |
| Profile GET/list | Adds `archived:boolean`; list adds `activeProfileVersionId`. Archived profiles remain visible but cannot be edited/activated/uploaded until restored. |
| `POST /api/profiles/:id/archive` | `{expectedRevision,archived:boolean}`; creates immutable revision/audit, clears active choice when archiving, preserves references and supports restore. |
| `GET /api/profiles/:id/attachments` | Owner-only metadata `{items}`; no object key or source URL exposed. |
| `POST /api/profiles/:id/attachments` | Strict multipart exactly `file` and `expectedRevision`; returns201 `{attachment:{id,status:'pending',scanStatus:'pending'},profile}`. Per-route raw multipart bound is8MiB+64KiB, actual file bound8MiB. All other body limits remain256KiB. |
| `GET /api/saved-jobs/:id/drafts` | Owner-only ordered draft summaries, latest first. |
| `GET /api/drafts/:id/history` | Owner-only immutable revisions with retained review content/status/timestamp. |
| `GET /api/activity?limit=&cursor=` | Bounded owner metadata events with continuation; no fabricated source activity or auth/email operational data for other actors. |

Later ingestion/generation/MCP code must preserve these owner/revision rules and archived-profile checks. Generation should reference the explicitly chosen active version or another explicitly supplied owned version. Archive is one authoritative profile state; saved-job archive remains its existing status value. Attachment scanner enablement must independently validate stored checksum/bytes before clean+available publication.

## Actual validation

| Check | Result |
|---|---|
| `pnpm lint` including React source | Passed, type-aware ESLint. |
| `pnpm typecheck` | Passed. |
| `pnpm typecheck:web` | Passed. |
| `pnpm typecheck:migration` | Passed. Added this exact command to root scripts/CI. |
| `pnpm test:integration` | **30/30 passed** in real workerd:17security,6existing data,7new user-flow checks. |
| `pnpm test:unit` | **29/29 passed**, including parent's actual localD1/R2 rehearsal. |
| `pnpm test:e2e` (first8cases) | **8/8 passed**,25.1s, actual Chromium + local Worker/D1/Better Auth. |
| Final added read-only viewport test | **1/1 passed**,3.6s, on the stable preview. This is the ninth case now present in the suite; it was run separately to avoid re-mutating the controller's fresh preview. |
| `pnpm build` | Vite emitted hashed assets to `apps/web/dist`; Worker dry-run succeeded,2606.44KiB /436.45KiB gzip. No upload/deploy. |
| `pnpm cf:types` | Passed; generated binding shapes match compiled-assets config. |
| `git diff --check` | Passed; only local line-ending conversion warnings. |

New API red/green evidence: initial5tests failed on absent archive/upload/options routes and missing saved-job labels; all5passed after implementation. Added2tests first failed on rejected idempotencyKey and status query, then all7passed. Browser login first failed on the placeholder, then passed. Full browser tests exposed unstable implicit accessible label lookup for populated textarea/select controls; explicit accessible names fixed it. Pagination test initially observed old DOM before the completed request and was corrected to await the real page response. Keyboard test initially opened the native select popup and then navigated before persistence; final sequence uses End, waits for enabled Update status, tabs to that button, presses Enter, waits for PATCH200 and verifies the actual Draft Ready→Archived change after reload.

The eight full flows cover real email/password sign-in; all32jobs across every page without duplicate/missingIDs; combined exact filters; loading/empty/500/retry; exact legacy description and source link; duplicate saving; profile create/activate/reload/second session; stale text retained; upload of a360KBsyntheticPDF exceeding the former JSON cap; quarantine and archive/restore; saved-field persistence; stale draft rejection, editing/approval and history; keyboard status persistence; second-owner denial;390px jobs overflow/skip link; logout/back masking; honest unavailable-mail UI; unsafe next-page rejection; expired-link terminal state; resumable B onboarding; account name persistence and password/current-password/revoked-session behavior.

The separate viewport sweep checks meaningful H1 content, no loading residue/framework overlay, no horizontal overflow, empty localStorage, and no JS/runtime console errors on dashboard, exact job detail, selected profile, saved detail and account at1280x844 and390x844. Browser skill/plugin was absent; the task explicitly required Playwright, and CUA was reserved for the controller. There was no CUA session use.

## Screenshot evidence

All synthetic screenshots are outside the repo at:
`C:/Users/htper/Documents/Codex/2026-09-11/files-mentioned-by-the-user-softr/work/task-4-browser/`

- `login-desktop.png`, `jobs-desktop.png`, `jobs-mobile.png`, `profile-desktop.png`, `dashboard-desktop.png` capture the interaction run. The mobile jobs image deliberately includes the focused Skip to content link.
- `dashboard-1280.png`, `job-details-1280.png`, `profile-1280.png`, `saved-details-1280.png`, `account-1280.png` capture the fresh preview.
- Corresponding `*-390.png` files capture each private surface at390px.

Visual checks inspected login, dashboard and mobile saved detail as well as the automated dimensions/DOM assertions. No clipping/overlap was found. Mobile forms/cards stack and user controls use44pxminimum height. Source static display facts that were invalid were intentionally omitted, not replaced with fabricated facts.

## Build/CI integration and remaining gates

Pinned newly installed React/ReactDOM19.3.0, Vite8.3.0, Reacttypes19.3.0 and Playwright1.63.0; official React/Vite/Workers docs and installed types/config were consulted. Added separate web typecheck, real frontend build, local synthetic preview, real Playwright script and CI Chromium install/e2e step. Parent-requested migration command aliases were added exactly. Default remote IDs remain UNPROVISIONED; writes, mail, generation and MCP default off.

Remaining live gates: configured verified sender and real successful verification/reset/delivery acceptance; explicit legacy identity activation; private-source browser native parity; deployed R2 checksum/download acceptance and malware scanner; later ingestion/provider/model assessment; generation and MCP implementation/readiness; staging/production provisioning and cutover. No scan success, application submission, real email delivery or native Softr parity is implied by these local results.

Editing stopped after this report and final test formatting. The controller may now review the implementation and stable preview independently.

## Fix round 1 — session revalidation and canonical IDs

Read `task-4-review.md` and reproduced both Important findings. Only `apps/web/src/main.tsx`, `apps/web/src/api.ts`, local test-port configuration (`playwright.config.ts`, `tests/e2e/preview.mjs`) and new `tests/e2e/review-fixes.spec.ts` changed. No staging/index change, commit, Worker/database/schema change, deployment, email, private-source read or CUA operation occurred.

- Background session checks now show checking/retry notices and retain the mounted editor state on network failures, HTTP5xx and non-JSON gateway errors. Successful retry removes the notice without resetting profile, saved-job or draft fields. Confirmed HTTP401 still removes private content and redirects; `api()` recognizes401 before parsing its body so a non-JSON401 cannot bypass this behavior.
- Canonical `/jobs/:id` and `/saved-jobs/:id` use the path ID exclusively. Only `/job-details` and `/saved-job-details` read `recordId`. The regression verifies both canonical record content and that saved-job edits affect only the path-selected row, then checks the legacy routes still work.
- The synthetic harness accepts a validated `SYNTHETIC_PORT`, supplies the corresponding exact local APP_ORIGIN, and allocates a separate inspector port. Default preview remains8787. Tests ran on8797 with fresh local D1/R2 state, preserving the controller's8787process and CUA tab.

Red/green: before production changes, the focused run had2failures (transient session handling and conflicting job path/query) and the real revoked401case passed. After the fixes, PowerShell **`$env:SYNTHETIC_PORT='8797'; pnpm exec playwright test tests/e2e/review-fixes.spec.ts`** reported **3passed (15.3s)**. The checks cover unsaved profile text through an HTML503 and recovery, saved-job notes plus draft cover letter through an aborted network request and recovery, real Better Auth sign-out followed by an actual401heartbeat, conflicting canonical IDs for jobs and saved jobs, owner-row persistence, and unchanged legacy query routes.

Focused validation: `pnpm lint`, `pnpm typecheck:web`, `pnpm typecheck`, `pnpm build`, and `git diff --check` all passed. The build emitted the new hashed JS (`index-CeX8yX0w.js`,343.40KB /102.91KB gzip) and the unchanged Worker dry-run bundle. No broader suite was rerun for this bounded frontend correction. Formatting ran after the passing browser test; production logic was unchanged by formatting.

The original preview Node PID13776 is still running, and a final read-only HTTP probe to `http://localhost:8787/login` returned200. No restart was necessary; the controller can refresh to load the rebuilt assets. Editing stopped after this appended report.
