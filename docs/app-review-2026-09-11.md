# App review and next steps — 2026-09-11

Review of the **AI Job Board & Draft Applications** app (`73913ca1-ce5d-4a96-95ac-598f361fb452`),
read through the builder MCP server on 2026-09-11. This is a follow-up to the
[workspace inventory](softr-workspace.md) taken on 2026-09-08; that document remains the
structural reference and is not superseded.

**Method:** read-only. Application, page, block, table, workflow and access-control metadata;
server-side aggregations over Job Listings, Saved Jobs, Draft Applications and Candidate Profile;
one unauthenticated HTTPS request to the published site. No record, schema, block or workflow was
created, changed, deleted, tested, published, or run. No API key values are reproduced here.

**Headline:** the app is live and serving, but its two engines are stopped. The job ingestion
pipeline has written nothing for at least three days, and the draft-generation workflow is
disabled and incomplete. Meanwhile `/job-details` and `/profile` are showing hardcoded example
content to real signed-in users.

---

## 1. What changed since 2026-09-08

Nothing in the data. Every count and distribution is identical to the 09-08 inventory:

| Table | Records on 09-08 | Records on 09-11 |
| --- | --- | --- |
| Job Listings | 295 | 295 |
| Saved Jobs | 30 | 30 |
| Draft Applications | 9 | 9 |
| Candidate Profile | 9 | 9 |
| Users | 6 | 6 |
| Submissions | 0 | 0 |

Saved Jobs and Draft Applications status distributions are also unchanged. The one moving part
is application metadata: `updated=2026-09-11T10:07:24` against `published=2026-09-07T05:30:55`,
so **the Studio draft has diverged from what is live** and someone should confirm what that
pending change is before the next publish.

---

## 2. Findings

Severity is about user-visible consequence, not effort. "Confirmed" means the stored
configuration, source, or a server-side count establishes it directly; "strong signal" means the
evidence is consistent but a native binding or a live run would be needed to close it out.

### P0-1 — The ingestion pipeline has been silently dead for ≥3 days

**Confirmed.** `MAX(Last Seen At)` across all 295 listings is **2026-09-08**. The workflow is
enabled (`enabledVersion=2`) on a daily `0 0 7 * * 1-7` schedule in America/Chicago, so the runs
on Sept 9 and Sept 10 — and probably Sept 11 — produced **zero writes**. Not zero creates: zero
writes of any kind, including the refresh step that touches every still-listed row.

The Sept 8 run was itself partial. It refreshed 81 Greenhouse rows and left 108 untouched, then
closed nothing at all. Under the configured diff logic those 108 absent Greenhouse rows should
have landed in `toClose` and been marked `Closed`. **0 of 295 listings are `Closed`.** So that run
also terminated after the refresh loop and before the close loop completed.

The structural cause is visible in the graph. `Ingest job listings`
(`5c830c7a-cdb1-4d7e-bc67-8aac1ede243c`) is a strictly linear chain of 13 steps with
`serialExecution=true`, and **no node sets `continueOnError`, and no node reports failure
anywhere**:

```
trigger → Anthropic board → Stripe board → Figma board → Fantastic ATS
       → Jobven p1 → Jobven p2 → load existing → normalize/diff
       → create GH → create ATS → create Jobven → refresh → close
```

Any one of those six upstream fetches failing takes down the entire run, including the refresh
and close steps that have no dependency on that feed. A quota exhaustion or a single 4xx from one
aggregator silently freezes the whole board, and nothing surfaces it.

Prime suspect for a hard failure: `Fetch Jobven (page 2)` (`02b3bf1a-95b1-45ab-95f7-7d637809dee9`)
passes `cursor = {outputs.<page1>:::$.body.meta.nextCursor}`. When page 1 returns fewer than 25
results there is no `nextCursor`, and the node sends an unresolved or empty cursor. That is a
guess until the run log is read — Softr's run history is only available in Studio, not over MCP.

**Do:**
1. Open the [workflow run history](https://studio.softr.io/workflow/5c830c7a-cdb1-4d7e-bc67-8aac1ede243c)
   and read the first failing node on the Sept 9 or Sept 10 run. This is the one step that needs a
   human at a browser; everything else below follows from what it says.
2. Set **continue on error** on all six `CALL_API` fetch nodes. A dead feed should cost you that
   feed's listings, not the whole run.
3. Guard the Jobven page-2 cursor, or drop page 2 until the pagination is worth the fragility.
4. Add a failure notification (Resend and Gmail are both already connected to the workspace).
   A pipeline that fails silently for three days is the actual bug; the fetch error is just what
   tripped it this time.

### P0-2 — `/job-details` shows a hardcoded fake job to every signed-in visitor

**Confirmed.** Block `29e50aa6-fe3f-42f6-aedc-2b5058aa8dcf` on `/job-details` is enabled, visible
to All users, and has `dataSources: []` and `actions: []`. Its persisted settings are still the
generator's example content — *Senior Software Engineer, Freddie Mac, McLean VA, $140,000 –
$180,000, "We are looking for a Senior Software Engineer to join our team…"* — and its apply link
points at `#`.

Because the settings are persisted values rather than code defaults, this renders that same fake
job on the live page **regardless of which real listing the visitor clicked**. The page also
carries a native `item-details1` block (`fa8916e0-3edd-454c-9929-a48e9a6ca264`) that does read the
selected Job Listings record, so the page currently presents a real job and an invented one side
by side, with the only working apply path on the native block.

**Do:** disable or delete block `29e50aa6`. The native details block already covers the page. This
is a two-minute fix and it is the most damaging thing currently visible to a user.

### P0-3 — All 295 listings claim to be "Open"; 214 have not been seen in days

**Confirmed.** Job Status is `Open` on every row, `Closed` on none. But 214 listings were last
confirmed present in their source feed *before* Sept 8:

| Source | Last seen 2026-08-29 | Last seen 2026-09-07 | Last seen 2026-09-08 |
| --- | --- | --- | --- |
| Greenhouse | — | 108 | 81 |
| Other (ATS / Jobven) | 28 | 78 | — |

So roughly **73% of the board is presented as live when it has not been verified for 3 to 13
days**, and users are applying into dead links. Two separate causes:

- The close rule is deliberately Greenhouse-only, and correctly so — the ATS and Jobven feeds are
  rolling windows, so absence there does not mean closure. But the consequence is that **no
  ATS or Jobven listing can ever expire by any mechanism**. Those 106 rows are immortal, and the
  28 from Aug 29 are the leading edge of a pile that only grows.
- The Greenhouse close rule that does exist has never once fired.

**Do:** add an age-based rule that the rolling-window sources can actually reach — e.g. Last Seen
At older than 7 days → `Unknown`, older than 14 → `Closed` — and run it as its own small workflow
rather than as a tail step of the fetch pipeline, so a feed outage can't disable expiry. Then
filter the job list blocks to `Job Status = Open`. Today they show everything.

### P0-4 — `/profile` invents activity and silently discards edits

**Confirmed.** Block `bab63294-4cf0-4eee-8d6e-1ec71631477a` has `actions: []`, and its `handleSave`
only calls `toast.success` and `setIsEditing(false)` — no mutation. A user edits their profile,
sees a success toast, and loses the change on reload.

Its `recent-activity` setting is also persisted fabricated content shown to every user as their
own history: *"Applied to Senior Developer — You submitted an application for the Senior Developer
position at TechCorp — 2 hours ago"*, *"Saved a job listing — Full Stack Engineer at StartupXYZ —
Yesterday"*, and two more. The block's location is likewise hardcoded to San Francisco.

Its wired datasources are Job Listings, Apify and Anthropic — **not** Candidate Profile and not
Users — while the source actually reads the signed-in user via `useCurrentUser`. So the wiring
and the code disagree about what this block is for.

**Do:** either wire it to Candidate Profile and give it a real update action, or replace it with a
native form block bound to Candidate Profile. Until one of those happens, remove the fake activity
feed — inventing a user's own history back at them is worse than showing nothing.

### P1-1 — Two third-party API keys are stored in plaintext in workflow headers

**Confirmed.** The `Fetch ATS jobs (Fantastic direct)` node and both Jobven nodes carry live
credentials as literal header values in their node inputs: a bearer token on the first and a
`jv_live_…` API key on the other two. Softr masks integration credentials elsewhere — the Anthropic
and Apify connections on the same app render as `sk-a****XQAA` and `apif****GK2I` — but
`CALL_API` header values are returned verbatim.

That means any session with builder access to this workspace can read both keys in full, including
**any MCP client you authorize**. This review read them without asking for them. That is the
expected behaviour of the tool, not a breach, but it defines the exposure: the keys are only as
private as the least-careful client you have ever connected.

**Do:** rotate both keys, and if Softr offers a managed connection or secret reference for
`CALL_API` on your plan, move them behind it. If it doesn't, at minimum keep the blast radius in
mind when granting workspace access. Do not paste the values into this repo or an issue tracker.

### P1-2 — Per-user isolation is unverified and there are zero data restrictions

**Strong signal, needs a browser to close out.** `dataRestrictionsCount` is **0** for the app, and
every page returns `EDIT → All users`. The Home kanban (`d71f8aed-adf9-4099-8bf3-4108e8d8248f`) is
bound to Saved Jobs with All-users block visibility and a drag-and-drop update action.

The 09-08 inventory recorded that an app-user-scoped read returned **all 30** Saved Jobs for a user
whose own relation holds 2. That was a datasource-level read and does not prove the rendered block
leaks — native row filters are not exposed over MCP and may well be set. But with zero global
restrictions in place, nothing *outside* the block is enforcing isolation either.

**Do:** sign in as a second test user and open `/`, `/profile` and `/saved-job-details`. If that
user can see or drag another user's saved jobs, this jumps to P0. This is cheap to check and
expensive to discover later.

### P2-1 — `Create Draft Application` is disabled, and would not work if enabled

**Confirmed from the graph.** It is disabled (`enabledVersion=0`, `draft=10`), and four separate
defects sit in the current version:

- **It never creates a draft.** Despite the name there is no `ADD_RECORD` step anywhere. It only
  updates drafts that already exist and are `In Progress` with a blank Cover Letter. It also never
  writes `Saved Jobs.Status`, so moving a saved job to `Draft Requested` does nothing on its own.
  This already shows in the data: 5 Saved Jobs sit in `Draft Requested`, and record
  `jA6IGvsdcqrrXq` has that status with no linked Draft Application at all.
- **It can generate a cover letter from the wrong person.** The queue builder falls back to
  `profileByOwner[owner] || profiles[0]` — when a draft's owner has no matching Candidate Profile
  it silently uses *the first profile in the table* rather than skipping the record. With 9
  profiles across 6 users, one of them blank-named and only 8 distinct names, that fallback is
  reachable. Sending someone else's career history to an employer under your name is the worst
  possible failure mode for this feature.
- **The final `Write` node is unrunnable.** `f56fecb8-d3e8-42be-941a-9bc6f8e1eff0` contains only a
  model and integration ID; its node specification requires an `instruction`. It has no saved
  output.
- **It reports success after failure.** The trailing end-user interaction displays its success
  message on `FAILED` as well as `SUCCEEDED`.

**Do:** decide what this workflow is for first. If it is "generate a draft for a saved job", it
needs a trigger input carrying the saved-job ID, an `ADD_RECORD`, and a write back to
`Saved Jobs.Status` — that is a rewrite of the front half, not a patch. Replace the
`profiles[0]` fallback with a skip in either case; that one is a correctness bug regardless of
the redesign. Do not enable it as it stands.

### P2-2 — The matching feature doesn't exist

**Confirmed.** `Fit Score` has **0** non-empty values across 295 listings, and `Fit Summary` and
`Recommended For` are empty table-wide. The schema for it is fully built — the score field with a
0–100 range, a 25-choice `Matched Skills` list, a `Recommended For` ↔ `Users.Recommended Jobs`
relation — and **nothing writes to any of it**. There is no matching workflow in the workspace;
only the two documented above exist.

This is the feature the app is named after. Scoring 295 listings against 9 profiles is a small,
well-shaped job: one scheduled workflow, one prompt per (profile × new listing) pair, write score
and summary. Worth doing *after* the pipeline is reliable, since scoring stale listings is wasted
spend.

### P3-1 — The SEO fields cannot pay off while every page is gated

**Confirmed.** Eight SEO/Social fields were added to Job Listings on 09-07. `SEO:Slug` is populated
on **30 of 295** rows; the rest are effectively unused. More to the point, an unauthenticated
request to `https://www.lakefrontdev.com/jobs` returns **`/login?next-page=/jobs`** — `/jobs`,
`/job-details` and `/` all require Logged in users, so no search engine can reach any of it. The
served page still carries Softr's stock meta description ("Made with Softr, the easiest way to turn
your data into internal tools…").

Per-record SEO fields and a fully login-walled site are two different products. Pick one: either
open `/jobs` and `/job-details` to All users and set the app's own meta, or drop the eight fields.
Populating slugs behind a login gate is pure cost.

### P3-2 — 93% of listings have no salary

**Confirmed.** `Salary Range Min` is empty on 275 of 295 (188 of 189 Greenhouse, 87 of 106 Other).
The Greenhouse create node maps no salary fields at all — the ATS and Jobven paths do, which is
where the 20 populated rows come from. Salary is usually the first filter a candidate reaches for,
so this materially weakens the board. Greenhouse's board API doesn't reliably carry compensation,
so this likely means parsing it out of the description text.

### P3-3 — Page clutter

**Confirmed configuration; visual impact untested.** `/jobs` has *six* content blocks enabled
simultaneously: two custom job lists (`1b3d3cb0`, `2f8ab39b`), a native grid (`36ed70e1`), three
charts, and a placeholder block (`3ee4f8bb`) that has Job Listings and Anthropic wired to it but
renders only `EmptyStatePlaceholder`. Home similarly stacks a welcome block, three charts, a tab
container, a grid and a kanban.

**Do:** delete `3ee4f8bb` outright — it renders nothing and only costs load time. Then pick one job
list for `/jobs` and disable the others.

### P3-4 — Smaller items

| Item | Evidence | Note |
| --- | --- | --- |
| Untitled Form app (`1384742e-…`) | Confirmed | Unpublished, `Submissions` table empty with only an autonumber field, and `/list` `/form` `/item-details` `/onboarding` require Logged in users while `get_user_connection` reports **no users table connected**. Those routes cannot admit anyone. Delete the app or finish it. |
| Two archive representations | Confirmed schema | Saved Jobs has both `Status = Archived` and an `Archived` checkbox, with no sync rule. They agree across all 30 rows today; they will drift. Drop one. |
| Duplicated profile attributes | Confirmed schema | `Users.Target Roles` / `Skills` are free text while the Candidate Profile equivalents are multi-select, with nothing synchronising them. Decide which table owns the candidate's attributes. |
| `Users.Role` has no choices | Confirmed schema | An empty SELECT that permits adding choices. Either define the roles or remove the field — it is not what gates the app, and leaving it invites someone to think it is. |
| Candidate Profile data quality | Confirmed | 9 profiles for 6 users, 8 distinct names, one blank (`xt4krgWd8iZJUN`). Worth a pass before anything generates documents from these records. |
| Unpublished Studio changes | Confirmed metadata | `updated` is 4 days ahead of `published`. Establish what the pending change is before publishing. |

---

## 3. Suggested order of work

The dependency that matters: **don't build on top of a pipeline that is currently stopped, and
don't spend model tokens scoring listings that are stale.**

**First sitting — stop showing users wrong things.** All four are small and independent.

1. Delete block `29e50aa6` on `/job-details` (P0-2).
2. Delete the placeholder block `3ee4f8bb` on `/jobs` (P3-3).
3. Remove the fabricated activity feed from `bab63294` on `/profile` (P0-4).
4. Sign in as a second test user and check Saved Jobs isolation (P1-2).

**Second — get the pipeline honest.** This is the load-bearing work; everything else assumes it.

5. Read the run history, find the failing node (P0-1).
6. Add continue-on-error to the six fetch nodes, guard the Jobven cursor, add failure alerting.
7. Add age-based expiry as a separate workflow, and filter the list blocks to `Open` (P0-3).
8. Rotate the two API keys (P1-1).

**Third — make the profile real.** Wire `bab63294` to Candidate Profile with a working save, or
replace it with a native form (P0-4). Drafts and matching both read from these records, so they
need to be trustworthy first.

**Fourth — pick one of the two AI features and finish it properly.** Matching (P2-2) is the better
first target: it's a single scheduled workflow with no app-trigger plumbing, it fills fields that
already exist, and it makes the board visibly smarter. Draft generation (P2-1) needs a redesign of
its front half and carries the wrong-profile risk, so it benefits from being second.

**Then** decide the SEO question (P3-1) — it's a positioning call about whether this is a public
job board or a private tool, and it's worth answering deliberately rather than by default.

---

## Limitations

Softr's builder MCP does not expose native block datasource or action configuration, native row
filters, native form fields, redirect destinations, the authentication-user roster, or workflow
run history. Findings resting on those are marked as signals above, not conclusions. Nothing here
was verified by driving the live app as a signed-in user; the single HTTP request made was
unauthenticated and read-only. Conclusions about custom blocks come from their persisted settings,
wired datasources and source, which is sufficient to establish what is stored but not to prove how
a page renders.
