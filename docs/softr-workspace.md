# Softr workspace inventory

Workspace: **Henry** (`99d735dc-b3b3-4f51-af8d-8df4c4091d5c`, default workspace).

Inspected: **2026-09-08**, through the authenticated builder MCP server at `https://mcp.softr.io/mcp`. This replaces the earlier app-user-scoped report.

**Inventory coverage:** 2 databases, 6 tables, 91 fields, 2 apps/forms, 21 page entries, 55 blocks, 3 predefined user groups per app, and 2 workflows. All were returned for the token's accessible workspace. No Softr records, schema, app configuration, users, or workflows were created, changed, deleted, tested, or published.

**Remaining limit:** the builder MCP exposes structural metadata for native blocks, but not their datasource/action configuration. All pages and blocks are listed below; native block bindings that cannot be established are explicitly marked unknown. Six custom-code blocks expose their wiring and source, which were inspected statically. No browser interaction or workflow execution was performed.

The local Codex connection was repaired by replacing a token mistakenly supplied as an environment-variable name with the `SOFTR_WORKSPACE_TOKEN` reference. Authentication succeeded. The cached tool catalog in this thread still exposed only the old app-user tools, so builder tools were called directly through the same MCP protocol and endpoint. Credentials are excluded from this report.

## 1. Databases, tables, fields, relations, and record counts

Counts below are workspace table metadata counts. `list_records` independently confirmed the complete totals for Users, Candidate Profile, Saved Jobs, and Draft Applications; a COUNT aggregation confirmed Job Listings. These replace counts limited by the earlier app-user read blocks.

| Database | Database ID | Table | Table ID | Fields | Records |
| --- | --- | --- | --- | --- | --- |
| Form values | `6bda234a-c281-4586-bf64-4478c6bcfe16` | Submissions | `MPqaP87cE1MsCv` | 1 | 0 |
| AI Job Board & Draft Applications | `a81814c7-d517-40d6-b926-66d49bba8851` | Users | `jlY4Kuae0x2iG7` | 14 | 6 |
| AI Job Board & Draft Applications | `a81814c7-d517-40d6-b926-66d49bba8851` | Candidate Profile | `pGOkkyhqqf97c7` | 19 | 9 |
| AI Job Board & Draft Applications | `a81814c7-d517-40d6-b926-66d49bba8851` | Job Listings | `OAV7rxXGxAj2a1` | 33 | 295 |
| AI Job Board & Draft Applications | `a81814c7-d517-40d6-b926-66d49bba8851` | Saved Jobs | `v3cxPKO973nVxq` | 12 | 30 |
| AI Job Board & Draft Applications | `a81814c7-d517-40d6-b926-66d49bba8851` | Draft Applications | `cvFoZD4aXb3YHJ` | 12 | 9 |

All 91 field definitions below came from `get_table`, once per table. **Multi** means `allowMultipleEntries=true`; “—” means false. All fields are optional. Only Submissions.Auto number is readonly; ordinary fields named Created At/Updated At are `DATETIME`, not system-managed timestamp field types. “Primary” identifies the table's display field. System record IDs and server record timestamps are separate record metadata.

### AI Job Board & Draft Applications

#### Users

| Field name | Field ID | Type | Multi | Notes |
| --- | --- | --- | --- | --- |
| Email | `c63tL` | `EMAIL` | — | Primary |
| Name | `o0JWv` | `SINGLE_LINE_TEXT` | — | — |
| Avatar | `QH0S6` | `ATTACHMENT` | — | — |
| Role | `z0b2k` | `SELECT` | — | — |
| Candidate Profiles | `zQwg2` | `LINKED_RECORD` | Yes | → Candidate Profile |
| Recommended Jobs | `U0SGB` | `LINKED_RECORD` | Yes | → Job Listings |
| Saved Jobs | `Sc7CY` | `LINKED_RECORD` | Yes | → Saved Jobs |
| Draft Applications | `gox5D` | `LINKED_RECORD` | Yes | → Draft Applications |
| Target Roles | `Ma5xR` | `SINGLE_LINE_TEXT` | — | — |
| Location / Remote Preference | `usRqT` | `SELECT` | — | — |
| Employment Type | `9UHk9` | `SELECT` | — | — |
| Seniority | `Eb3Gk` | `SELECT` | — | — |
| Salary Range | `TBaRn` | `SINGLE_LINE_TEXT` | — | — |
| Skills | `X0Xyi` | `SINGLE_LINE_TEXT` | — | — |

#### Candidate Profile

| Field name | Field ID | Type | Multi | Notes |
| --- | --- | --- | --- | --- |
| Full Name | `JsepF` | `SINGLE_LINE_TEXT` | — | Primary |
| Email | `STp8T` | `EMAIL` | — | — |
| Headline | `a6HnR` | `SINGLE_LINE_TEXT` | — | — |
| Location | `s91mE` | `SINGLE_LINE_TEXT` | — | — |
| Target Roles | `mQtF2` | `SELECT` | Yes | — |
| Skills | `kPJYk` | `SELECT` | Yes | — |
| Years of Experience | `ivALq` | `NUMBER` | — | — |
| Portfolio URL | `PVhtG` | `URL` | — | — |
| LinkedIn URL | `oybjv` | `URL` | — | — |
| GitHub URL | `xItg1` | `URL` | — | — |
| Summary | `ANMOx` | `LONG_TEXT` | — | — |
| Resume File | `z5BqF` | `ATTACHMENT` | — | — |
| Additional Documents | `XqXl3` | `ATTACHMENT` | Yes | — |
| Preferred Work Type | `QSfxM` | `SELECT` | — | — |
| Preferred Employment Type | `PAvUp` | `SELECT` | — | — |
| Salary Minimum | `u3v0Q` | `NUMBER` | — | — |
| Created At | `fPK4m` | `DATETIME` | — | — |
| Updated At | `aGnZ7` | `DATETIME` | — | — |
| Owner | `jEkaS` | `LINKED_RECORD` | — | → Users |

#### Job Listings

| Field name | Field ID | Type | Multi | Notes |
| --- | --- | --- | --- | --- |
| Job Title | `FSayV` | `SINGLE_LINE_TEXT` | — | Primary |
| Company | `8FbKI` | `SINGLE_LINE_TEXT` | — | — |
| Source | `b65iu` | `SELECT` | — | — |
| Source Job URL | `mIAha` | `URL` | — | — |
| Location | `V9DKL` | `SINGLE_LINE_TEXT` | — | — |
| Remote Policy | `nqBM6` | `SELECT` | — | — |
| Employment Type | `L391o` | `SELECT` | — | — |
| Seniority | `O5o9t` | `SELECT` | — | — |
| Salary Range Min | `zSryi` | `NUMBER` | — | — |
| Salary Range Max | `diQfJ` | `NUMBER` | — | — |
| Description | `Q3LGs` | `LONG_TEXT` | — | — |
| Requirements | `D5upg` | `LONG_TEXT` | — | — |
| Posted Date | `tWFbv` | `DATETIME` | — | — |
| Job Status | `DRtJ2` | `SELECT` | — | — |
| Tags | `XMuIF` | `SELECT` | Yes | — |
| Fit Score | `X2V8c` | `NUMBER` | — | — |
| Fit Summary | `4WR79` | `LONG_TEXT` | — | — |
| Matched Skills | `BxJys` | `SELECT` | Yes | — |
| Created At | `wQPca` | `DATETIME` | — | — |
| Updated At | `Xnlg9` | `DATETIME` | — | — |
| Recommended For | `yKtWe` | `LINKED_RECORD` | Yes | → Users |
| Saves | `wJ1nC` | `LINKED_RECORD` | Yes | → Saved Jobs |
| Company Size | `Rb6TP` | `SELECT` | — | — |
| Required Skills | `zhgSV` | `SELECT` | Yes | — |
| External ID | `m348V` | `SINGLE_LINE_TEXT` | — | — |
| Last Seen At | `NC9f8` | `DATETIME` | — | — |
| SEO:Index | `8paQw` | `CHECKBOX` | — | — |
| SEO:Slug | `oWary` | `SINGLE_LINE_TEXT` | — | — |
| SEO:Title | `JTXqU` | `SINGLE_LINE_TEXT` | — | — |
| SEO:Description | `WjYTI` | `LONG_TEXT` | — | — |
| Social:Image | `PqSVr` | `URL` | — | — |
| Social:Title | `b0QJo` | `SINGLE_LINE_TEXT` | — | — |
| Social:Description | `JfC7P` | `LONG_TEXT` | — | — |

#### Saved Jobs

| Field name | Field ID | Type | Multi | Notes |
| --- | --- | --- | --- | --- |
| Saved Job Name | `e9Y1b` | `SINGLE_LINE_TEXT` | — | Primary |
| Status | `rlRAa` | `SELECT` | — | — |
| Priority | `gxH0q` | `SELECT` | — | — |
| Notes | `tvEUH` | `LONG_TEXT` | — | — |
| Saved At | `zLAYB` | `DATETIME` | — | — |
| Last Activity At | `2qIDL` | `DATETIME` | — | — |
| Outcome Notes | `G5cxV` | `LONG_TEXT` | — | — |
| External Submission URL | `3PFAm` | `URL` | — | — |
| Archived | `2jlPC` | `CHECKBOX` | — | Default `false` |
| User | `pKLXK` | `LINKED_RECORD` | — | → Users |
| Job | `1WNQH` | `LINKED_RECORD` | — | → Job Listings |
| Draft Applications | `Rbf50` | `LINKED_RECORD` | Yes | → Draft Applications |

#### Draft Applications

| Field name | Field ID | Type | Multi | Notes |
| --- | --- | --- | --- | --- |
| Draft Title | `phce0` | `SINGLE_LINE_TEXT` | — | Primary |
| Draft Status | `MPaUx` | `SELECT` | — | — |
| Selected Resume | `qEJJe` | `ATTACHMENT` | — | — |
| Cover Letter | `gL7sY` | `LONG_TEXT` | — | — |
| Short Answers | `Xmae7` | `LONG_TEXT` | — | — |
| Key Match Points | `oiZvd` | `LONG_TEXT` | — | — |
| Missing Info Questions | `JQ95r` | `LONG_TEXT` | — | — |
| Reviewer Notes | `Oqava` | `LONG_TEXT` | — | — |
| Generated At | `Ky7zP` | `DATETIME` | — | — |
| Updated At | `HtDsK` | `DATETIME` | — | — |
| Saved Job | `KxqMq` | `LINKED_RECORD` | — | → Saved Jobs |
| User | `0kz7P` | `LINKED_RECORD` | — | → Users |

### Form values

#### Submissions

| Field name | Field ID | Type | Multi | Notes |
| --- | --- | --- | --- | --- |
| Auto number | `CQ6Yc` | `AUTONUMBER` | — | Primary; Readonly |

### Relations

These targets, inverse fields, and multiplicities are confirmed by full schema options. “One” means at most one link; all relation fields are optional. Every relation is inside AI Job Board & Draft Applications. Submissions has no relation fields.

| Field | Links per source record | Inverse field | Links per target record |
| --- | --- | --- | --- |
| Draft Applications.Saved Job (`KxqMq`) | One | Saved Jobs.Draft Applications (`Rbf50`) | Many |
| Draft Applications.User (`0kz7P`) | One | Users.Draft Applications (`gox5D`) | Many |
| Users.Candidate Profiles (`zQwg2`) | Many | Candidate Profile.Owner (`jEkaS`) | One |
| Users.Recommended Jobs (`U0SGB`) | Many | Job Listings.Recommended For (`yKtWe`) | Many |
| Users.Saved Jobs (`Sc7CY`) | Many | Saved Jobs.User (`pKLXK`) | One |
| Job Listings.Saves (`wJ1nC`) | Many | Saved Jobs.Job (`1WNQH`) | One |

The current app-user identity from the initial read is linked to Users record `g7dekVu4S3PYXt`. Its two saved jobs and empty draft list are an individual user's data, not database totals. The full table contains 9 Draft Applications and 9 Candidate Profile records. Draft Applications has confirmed Saved Job and User relations, and Candidate Profile's formerly unresolved primary field is **Full Name** (`JsepF`).

### Other connected services

`list_data_sources` returned 13 integrations: Softr databases, Gmail, Apify, Anthropic, Firecrawl, Linkup, OpenAI, Google Calendar, Resend, Replicate, Elastic Email, Airtable, and Cal.com. Only Softr databases supplied tables in this inventory. The connected Airtable integration returned an empty accessible-base list (`[]`); no Airtable tables could be enumerated. This does not establish that the Airtable account itself has no bases. Other connections are service integrations rather than additional Softr database tables. Account emails and masked credential-derived integration names are omitted.

## 2. Status, lifecycle, and enumerated values

### Closed status lists

All three status fields are single-select, optional, have no default, and set `allowToAddNewChoice=false`. These are their exact configured nonblank labels and IDs; blank is not an additional named status.

#### Job Listings.Job Status (`DRtJ2`)

| Exact allowed label | Choice ID |
| --- | --- |
| `Open` | `8a4d87f0-3b78-4957-84ed-364b4e80dd0b` |
| `Closed` | `c1ee3460-3433-4f78-93c8-d51023f587b5` |
| `Unknown` | `fee67791-81ca-4d72-b98d-91546d39fd28` |

#### Saved Jobs.Status (`rlRAa`)

| Exact allowed label | Choice ID |
| --- | --- |
| `Saved` | `7c12c26a-d495-4321-b85b-c13910b2401d` |
| `Draft Requested` | `f8e85095-40a1-4a42-8020-47c5c8fdd12e` |
| `Draft Ready` | `89fb4118-a156-4743-b9d0-d6ac1d85fa90` |
| `Submitted` | `d88de105-b172-48b1-8668-892430ac6b28` |
| `Rejected` | `10977fc6-9362-4d9b-8c59-7325ca3957fb` |
| `Offer` | `e291aae9-deff-46b0-984a-80ba8598117c` |
| `Archived` | `272ce2ed-de07-4a9c-a17b-043ee09c8dcf` |

#### Draft Applications.Draft Status (`MPaUx`)

| Exact allowed label | Choice ID |
| --- | --- |
| `In Progress` | `e1f17d4a-beec-44d5-8a31-e74daed6cddb` |
| `Ready for Review` | `9a1fc4c8-3033-41e8-a929-5388a7d2419a` |
| `Approved` | `322c28c0-7ddc-47ab-b175-653f3ddfa3ee` |
| `Needs Edits` | `ce1a2960-b5f4-4889-930f-c103d53470a7` |

### Other lifecycle and state fields

| Field | Type / allowed values | Behavior or default |
| --- | --- | --- |
| Saved Jobs.Archived (`2jlPC`) | CHECKBOX: `true`, `false` | Default `false`. Separate from Status=Archived; all 30 records currently agree between these two representations. |
| Job Listings.SEO:Index (`8paQw`) | CHECKBOX: `true`, `false` | Search-indexing eligibility, not application publish state; schema default `null` |
| Job Listings.Posted Date; Created At; Updated At; Last Seen At | DATETIME | Lifecycle timestamps, no enumerated choices |
| Candidate Profile.Created At; Updated At | DATETIME | Lifecycle timestamps, no enumerated choices |
| Saved Jobs.Saved At; Last Activity At | DATETIME | Lifecycle timestamps, no enumerated choices |
| Draft Applications.Generated At; Updated At | DATETIME | Lifecycle timestamps, no enumerated choices |
| Users.Role | SELECT; current choices `[]`; adding choices allowed | No predefined role labels. This field is not the app user-group configuration. |

### Observed status distribution

| Table | Status | Records |
| --- | --- | --- |
| Job Listings | Open | 295 |
| Saved Jobs | Draft Requested | 5 |
| Saved Jobs | Draft Ready | 4 |
| Saved Jobs | Saved | 11 |
| Saved Jobs | Submitted | 5 |
| Saved Jobs | Rejected | 2 |
| Saved Jobs | Archived | 3 |
| Draft Applications | In Progress | 2 |
| Draft Applications | Ready for Review | 2 |
| Draft Applications | Approved | 2 |
| Draft Applications | Needs Edits | 3 |

Job Listings has 0 Closed and 0 Unknown records. Saved Jobs has 0 Offer records. All 295 job listings have empty Fit Score, Fit Summary, and Recommended For fields, confirmed by separate server-side IS_EMPTY count aggregations.

### All other SELECT choices

Labels below are exact. “Can add choices” distinguishes a closed list from current options that the database permits extending. Multi-select fields also allow combinations of the listed labels. This inventory does not add any choices.

#### Users

| Field | Multi | Can add choices | Exact current labels |
| --- | --- | --- | --- |
| Role | No | Yes | `[]` |
| Location / Remote Preference | No | Yes | `Remote`, `Hybrid`, `On-site`, `Open to relocation` |
| Employment Type | No | Yes | `Full-time`, `Contract`, `Part-time`, `Internship` |
| Seniority | No | Yes | `Internship`, `Junior`, `Mid`, `Senior`, `Lead`, `Manager`, `Director`, `Executive` |

#### Job Listings

| Field | Multi | Can add choices | Exact current labels |
| --- | --- | --- | --- |
| Source | No | No | `LinkedIn`, `Indeed`, `Greenhouse`, `Lever`, `Workday`, `Company Site`, `Other` |
| Remote Policy | No | No | `Remote`, `Hybrid`, `On-site`, `Unknown` |
| Employment Type | No | No | `Full-time`, `Contract`, `Part-time`, `Internship`, `Unknown` |
| Seniority | No | No | `Internship`, `Junior`, `Mid`, `Senior`, `Lead`, `Manager`, `Director`, `Executive`, `Unknown` |
| Tags | Yes | Yes | `Engineering`, `Cloud`, `High Growth`, `Product`, `Strategy`, `SaaS`, `Data Science`, `Machine Learning`, `Fintech`, `Design`, `Mobile`, `UI/UX`, `Marketing`, `Operations`, `MarTech`, `React`, `Startup`, `Internship`, `University`, `Executive`, `Leadership`, `Enterprise` |
| Matched Skills | Yes | Yes | `React`, `Go`, `Kubernetes`, `AWS`, `Product Strategy`, `SaaS`, `Roadmapping`, `Python`, `SQL`, `Machine Learning`, `Figma`, `User Research`, `Prototyping`, `Salesforce`, `Data Analysis`, `HTML/CSS`, `JavaScript`, `Java`, `Leadership`, `Management`, `WordPress`, `PHP`, `LEMP`, `Claude Code`, `MCP tooling` |
| Company Size | No | Yes | `1-10`, `11-50`, `51-200`, `201-500`, `501-1000`, `1000+` |
| Required Skills | Yes | Yes | `React`, `JavaScript`, `TypeScript`, `Python`, `Node.js`, `SQL`, `AWS`, `Docker`, `Kubernetes`, `Figma`, `User Research`, `Product Strategy`, `Data Analysis`, `Machine Learning`, `Salesforce`, `Marketing`, `Go`, `Java`, `HTML/CSS`, `Leadership`, `Management` |

#### Candidate Profile

| Field | Multi | Can add choices | Exact current labels |
| --- | --- | --- | --- |
| Target Roles | Yes | Yes | `Full Stack Developer`, `Software Engineer`, `UX Designer`, `Product Manager`, `Data Scientist`, `Backend Developer`, `Frontend Developer`, `DevOps Engineer`, `Project Manager` |
| Skills | Yes | Yes | `JavaScript`, `React`, `Node.js`, `AWS`, `SQL`, `Figma`, `User Research`, `Agile`, `Adobe XD`, `Python`, `Machine Learning`, `Docker`, `Java`, `TypeScript`, `CSS`, `Git`, `Terraform`, `Kubernetes`, `Scrum`, `Jira`, `Spring Boot`, `WordPress`, `PHP`, `LEMP`, `Claude Code`, `MCP tooling` |
| Preferred Work Type | No | No | `Remote`, `Hybrid`, `On-site` |
| Preferred Employment Type | No | No | `Full-time`, `Contract`, `Part-time`, `Internship` |

#### Saved Jobs

| Field | Multi | Can add choices | Exact current labels |
| --- | --- | --- | --- |
| Priority | No | No | `Low`, `Medium`, `High` |

## 3. Apps, pages, blocks, and table bindings

Every returned page is enabled. Every returned block is enabled and available on laptop, tablet, and mobile. Page title/description metadata and block order values are null. Rows follow response order; nesting and visual layout order are not reconstructed from null order values. `SHARED_BLOCKS` entries are internal shared-block containers, not ordinary user pages.

The **View** setting is the page gate. Block visibility applies within that gate. A block marked All users on a page restricted to Logged in users does not make that page public.

**Binding evidence:** `get_page` and `get_block` omit native datasource and action configuration. The custom-code settings tool rejects native blocks. Native read targets are confirmed only where the initial App MCP's `usedBlocks` identifies that exact block. Other native bindings are marked unknown or inferred. Static navigation/container/utility blocks have no table binding exposed. Account blocks use Softr's account service. A follow-up `get_user_connection` read identifies the job board's user connection by an exact field-ID match to Users; individual account-block actions remain unexposed. See [User connections](#user-connections).

### AI Job Board & Draft Applications

Application ID: `73913ca1-ce5d-4a96-95ac-598f361fb452`. Type: `REGULAR_APPLICATION`. 15 page entries. [Open in Studio](https://studio.softr.io/applications/73913ca1-ce5d-4a96-95ac-598f361fb452).

#### Sign up — `/sign-up`

Page `0647e3c5-2411-4bba-b41d-47ebaabeb929`; type `SIGN_UP`; **View: All users**. [Studio page](https://studio.softr.io/applications/73913ca1-ce5d-4a96-95ac-598f361fb452/pages/0647e3c5-2411-4bba-b41d-47ebaabeb929).

| Block | Block ID | Type / category | Block visibility | Reads / connections | Writes / actions |
| --- | --- | --- | --- | --- | --- |
| user-accounts1 — Sign Up | `1f42d7e7-fac1-4a9e-a65b-e4737e438f13` | DYNAMIC / User Accounts | Non Logged in users | Softr account service; Users connection (schema match) | Account operation indicated by block type; detailed configuration unknown |

#### Page not found — `/404`

Page `18087b60-cec0-49df-86f6-64b0b0539908`; type `PAGE_NOT_FOUND`; **View: All users**. [Studio page](https://studio.softr.io/applications/73913ca1-ce5d-4a96-95ac-598f361fb452/pages/18087b60-cec0-49df-86f6-64b0b0539908).

| Block | Block ID | Type / category | Block visibility | Reads / connections | Writes / actions |
| --- | --- | --- | --- | --- | --- |
| utility1 — Page not found | `8032d13d-4f8c-4584-ba52-29513dad0774` | STATIC / Utility | All users | No table binding exposed | No record action exposed |

#### Jobs — `/jobs`

Page `3bbf3c3b-a391-4b00-9947-548b4ee9dfc9`; type `USER`; **View: Logged in users**. [Studio page](https://studio.softr.io/applications/73913ca1-ce5d-4a96-95ac-598f361fb452/pages/3bbf3c3b-a391-4b00-9947-548b4ee9dfc9).

| Block | Block ID | Type / category | Block visibility | Reads / connections | Writes / actions |
| --- | --- | --- | --- | --- | --- |
| header1 — navigation | `fba083e0-e56c-4518-a9d6-132207c58d0b` | STATIC / Header | All users | No table binding exposed | No record action exposed |
| vibe-coding1 — Job list (view job → details) | `1b3d3cb0-39a3-4e1a-b3af-56b31a884b2a` | STATIC / AI | All users | Reads Job Listings via `useRecords` | No record actions or write calls found |
| ai3 — Vibe coding block | `3ee4f8bb-4a44-49f0-b5d4-cae711244391` | DYNAMIC / AI | All users | Job Listings + Anthropic attached; placeholder source performs no data read | None; placeholder only |
| ai2 — Vibe coding block | `2f8ab39b-129c-4da3-9abf-72b2d6200337` | DYNAMIC / AI | All users | Reads Job Listings via `useRecords`; Apify, Firecrawl, Linkup connections also attached | No record actions or write calls found |
| column-container1 — Column container | `65822038-1ea0-4724-ae5a-adc00d78d29c` | CONTAINER / Container | All users | No table binding exposed | No record action exposed |
| grid1 — Horizontal card | `36ed70e1-398d-4d09-9079-36a82c79e50c` | DYNAMIC / Grid | All users | Unknown: native datasource configuration omitted | Unknown: native action configuration omitted |
| chart1 — Chart | `4daa6645-3389-4ac2-9e60-53d06a42efd3` | DYNAMIC / Chart | All users | Unknown: native datasource configuration omitted | Unknown: native action configuration omitted |
| chart2 — Chart | `a6168e2c-3e68-4ff1-970d-6d03ad53035d` | DYNAMIC / Chart | All users | Unknown: native datasource configuration omitted | Unknown: native action configuration omitted |
| chart3 — Chart | `b08c0a38-e2b4-4d64-9968-8cfa786df519` | DYNAMIC / Chart | All users | Unknown: native datasource configuration omitted | Unknown: native action configuration omitted |
| footer1 — footer | `816f0c0c-2c8f-4cad-9343-93008277d316` | STATIC / Footer | All users | No table binding exposed | No record action exposed |

#### Account settings — `/account`

Page `4024b8cb-9fc6-4e14-89b6-d096939f7af4`; type `USER_ACCOUNT`; **View: Logged in users**. [Studio page](https://studio.softr.io/applications/73913ca1-ce5d-4a96-95ac-598f361fb452/pages/4024b8cb-9fc6-4e14-89b6-d096939f7af4).

| Block | Block ID | Type / category | Block visibility | Reads / connections | Writes / actions |
| --- | --- | --- | --- | --- | --- |
| header1 — navigation | `3492a64e-cc7f-4798-916e-1176c223f422` | STATIC / Header | All users | No table binding exposed | No record action exposed |
| user-accounts1 — Account Settings | `36fa5be1-2832-46d4-a951-37592e24e2e4` | DYNAMIC / User Accounts | Logged in users | Softr account service; Users connection (schema match) | Account operation indicated by block type; detailed configuration unknown |

#### Job Details — `/job-details`

Page `61b70712-591e-43f8-a496-3c3b3d98adcd`; type `USER`; **View: Logged in users**. [Studio page](https://studio.softr.io/applications/73913ca1-ce5d-4a96-95ac-598f361fb452/pages/61b70712-591e-43f8-a496-3c3b3d98adcd).

| Block | Block ID | Type / category | Block visibility | Reads / connections | Writes / actions |
| --- | --- | --- | --- | --- | --- |
| header1 — navigation | `3f90bb74-67a4-4548-8892-f771ced6e42d` | STATIC / Header | All users | No table binding exposed | No record action exposed |
| ai1 — Vibe coding block | `29e50aa6-fe3f-42f6-aedc-2b5058aa8dcf` | DYNAMIC / AI | All users | No datasource; fixed editable settings | None; Apply URL is `#` |
| item-details1 — Item details | `fa8916e0-3edd-454c-9929-a48e9a6ca264` | DYNAMIC / Item Details | All users | Job Listings (confirmed App MCP read) | Native action configuration unknown |
| list1 — List | `113f6fa2-a510-49b7-9365-739b95ff9ec5` | DYNAMIC / List | All users | Unknown: native datasource configuration omitted | Unknown: native action configuration omitted |

#### Link expired — `/link-expired`

Page `63cfeec0-cc4b-4918-87f4-c87bf38468fa`; type `LINK_EXPIRED`; **View: All users**. [Studio page](https://studio.softr.io/applications/73913ca1-ce5d-4a96-95ac-598f361fb452/pages/63cfeec0-cc4b-4918-87f4-c87bf38468fa).

| Block | Block ID | Type / category | Block visibility | Reads / connections | Writes / actions |
| --- | --- | --- | --- | --- | --- |
| utility1 — Link expired | `4d03d066-139e-4bb1-b054-633753bfa4c7` | STATIC / Utility | All users | No table binding exposed | No record action exposed |

#### Onboarding flow — `/onboarding`

Page `8d1f57ca-0a76-4001-b268-64e3c80a8e98`; type `ONBOARDING_FLOW`; **View: Logged in users**. [Studio page](https://studio.softr.io/applications/73913ca1-ce5d-4a96-95ac-598f361fb452/pages/8d1f57ca-0a76-4001-b268-64e3c80a8e98).

| Block | Block ID | Type / category | Block visibility | Reads / connections | Writes / actions |
| --- | --- | --- | --- | --- | --- |
| onboarding-flow — Onboarding | `90602d8a-abea-4de9-8e1b-d6215260a748` | DYNAMIC / Form | All users | Unknown: native datasource configuration omitted | Unknown: native action configuration omitted |

#### Forgot password — `/forgot-password`

Page `98c99155-89c1-4a9c-96aa-4fd20febdfaa`; type `FORGOT_PASSWORD`; **View: All users**. [Studio page](https://studio.softr.io/applications/73913ca1-ce5d-4a96-95ac-598f361fb452/pages/98c99155-89c1-4a9c-96aa-4fd20febdfaa).

| Block | Block ID | Type / category | Block visibility | Reads / connections | Writes / actions |
| --- | --- | --- | --- | --- | --- |
| user-accounts1 — Forgot password | `227ee2f5-b37c-472a-94ab-7e67a527b343` | DYNAMIC / User Accounts | All users | Softr account service; Users connection (schema match) | Account operation indicated by block type; detailed configuration unknown |

#### Profile — `/profile`

Page `9ea09641-eb5f-4c6a-b0a9-eeeb5868bc1b`; type `USER`; **View: Logged in users**. [Studio page](https://studio.softr.io/applications/73913ca1-ce5d-4a96-95ac-598f361fb452/pages/9ea09641-eb5f-4c6a-b0a9-eeeb5868bc1b).

| Block | Block ID | Type / category | Block visibility | Reads / connections | Writes / actions |
| --- | --- | --- | --- | --- | --- |
| header1 — navigation | `cc7a9d0b-b99f-41e4-add7-65126128e33d` | STATIC / Header | All users | No table binding exposed | No record action exposed |
| ai1 — Vibe coding block | `bab63294-4cf0-4eee-8d6e-1ec71631477a` | DYNAMIC / AI | All users | Reads current user properties (Users field IDs); Job Listings, Apify, Anthropic attached but unused in source | None; save handler only shows toast and exits editing |
| table1 — Table | `10d15ff9-f27f-4ecf-9bf0-3c9744816458` | DYNAMIC / Table | All users | Draft Applications (confirmed App MCP read) | Native action configuration unknown |
| form1 — Conditional Form | `fe386d41-8495-485b-8469-4867413625c9` | DYNAMIC / Form | All users | Native form fields not exposed | Candidate Profile create inferred from sole Submit Form action on /profile |

#### Reset password — `/reset-password`

Page `c45b6c29-81c1-4050-a6b4-8793f080727d`; type `RESET_PASSWORD`; **View: All users**. [Studio page](https://studio.softr.io/applications/73913ca1-ce5d-4a96-95ac-598f361fb452/pages/c45b6c29-81c1-4050-a6b4-8793f080727d).

| Block | Block ID | Type / category | Block visibility | Reads / connections | Writes / actions |
| --- | --- | --- | --- | --- | --- |
| user-accounts1 — Reset password | `5189e373-0663-48db-82b2-425612c5d030` | DYNAMIC / User Accounts | All users | Softr account service; Users connection (schema match) | Account operation indicated by block type; detailed configuration unknown |

#### 9136419c-df18-45f2-8821-ed6fa6993b3a — `/c7cdf289-efa8-4e65-b64b-847b9b60db22`

Page `cb18254c-57b5-419c-929d-340cc7b81f87`; type `SHARED_BLOCKS`; **View: All users**. [Studio page](https://studio.softr.io/applications/73913ca1-ce5d-4a96-95ac-598f361fb452/pages/cb18254c-57b5-419c-929d-340cc7b81f87).

| Block | Block ID | Type / category | Block visibility | Reads / connections | Writes / actions |
| --- | --- | --- | --- | --- | --- |
| home-header3 — Navigation | `53b629af-3bdd-4687-84e1-f57c5fccf4a5` | STATIC / Header | All users | No table binding exposed | No record action exposed |
| footer1 — Footer | `ddffab83-1318-4280-aaa2-6b36a6dc9a77` | STATIC / Footer | All users | No table binding exposed | No record action exposed |

#### Log in — `/login`

Page `de11ea45-f534-4fc1-a6c6-fc14636e0339`; type `LOG_IN`; **View: All users**. [Studio page](https://studio.softr.io/applications/73913ca1-ce5d-4a96-95ac-598f361fb452/pages/de11ea45-f534-4fc1-a6c6-fc14636e0339).

| Block | Block ID | Type / category | Block visibility | Reads / connections | Writes / actions |
| --- | --- | --- | --- | --- | --- |
| user-accounts1 — Sign In | `255ab587-5139-43c9-a734-86b23c7412d1` | DYNAMIC / User Accounts | Non Logged in users | Softr account service; Users connection (schema match) | Account operation indicated by block type; detailed configuration unknown |

#### Permission denied — `/401`

Page `e2e12508-984a-4659-b1d1-1fb14c4172e9`; type `PERMISSION_DENIED`; **View: All users**. [Studio page](https://studio.softr.io/applications/73913ca1-ce5d-4a96-95ac-598f361fb452/pages/e2e12508-984a-4659-b1d1-1fb14c4172e9).

| Block | Block ID | Type / category | Block visibility | Reads / connections | Writes / actions |
| --- | --- | --- | --- | --- | --- |
| utility1 — Permission denied | `31cd67b1-38b4-460c-88b4-8ee43ae70c8b` | STATIC / Utility | All users | No table binding exposed | No record action exposed |

#### Home — `/`

Page `f03bd363-456f-4a6d-b64f-cfb81e7f737e`; type `USER`; **View: Logged in users**. [Studio page](https://studio.softr.io/applications/73913ca1-ce5d-4a96-95ac-598f361fb452/pages/f03bd363-456f-4a6d-b64f-cfb81e7f737e).

| Block | Block ID | Type / category | Block visibility | Reads / connections | Writes / actions |
| --- | --- | --- | --- | --- | --- |
| home-header3 — navigation | `8e3783fe-2823-441e-8428-555fd68f32af` | STATIC / Header | All users | No table binding exposed | No record action exposed |
| welcome1 — Soft gradient | `6c7286b2-9f10-4eb5-85f6-88a979433213` | STATIC / Welcome | All users | Greeting/settings; Job Listings attached but no table query found | No record actions or write calls found |
| column-container1 — Column container | `cc5378fc-f78e-49d1-a760-4c7c4c20fd97` | CONTAINER / Container | All users | No table binding exposed | No record action exposed |
| tab-container1 — Tab container | `9db238d2-a862-4696-900b-53e38695df0f` | CONTAINER / Container | All users | No table binding exposed | No record action exposed |
| chart1 — Chart | `23f3d9a5-c30c-444c-b730-625b87e6e033` | DYNAMIC / Chart | All users | Unknown: native datasource configuration omitted | Unknown: native action configuration omitted |
| chart2 — Chart | `b1c0cb62-fd92-41f5-ad30-57746672a646` | DYNAMIC / Chart | All users | Unknown: native datasource configuration omitted | Unknown: native action configuration omitted |
| chart3 — Chart | `35d7c409-efe8-47f0-b27d-2c5f7f12fb3e` | DYNAMIC / Chart | All users | Unknown: native datasource configuration omitted | Unknown: native action configuration omitted |
| tab1 — Tab | `fd03d218-1cf6-4c45-bb85-54829c380d11` | CONTAINER / Container | All users | No table binding exposed | No record action exposed |
| tab2 — Tab | `7a9bab12-beac-4466-bcf9-e7c403c61a05` | CONTAINER / Container | All users | No table binding exposed | No record action exposed |
| grid1 — Horizontal card | `edd7273e-18ff-4c2d-8259-22aaa69e6deb` | DYNAMIC / Grid | All users | Unknown: native datasource configuration omitted | Unknown: native action configuration omitted |
| kanban1 — Kanban board | `d71f8aed-adf9-4099-8bf3-4108e8d8248f` | DYNAMIC / Kanban | All users | Likely Saved Jobs; inferred from Kanban/Drag and drop context | Saved Jobs update inferred; exact action binding unknown |
| home-footer1 — footer | `b1094b74-9a11-4d61-9ed1-5c9653a50da9` | STATIC / Footer | All users | No table binding exposed | No record action exposed |

#### Saved Job Details — `/saved-job-details`

Page `fddee8d7-2790-4131-823a-555869510a36`; type `USER`; **View: Logged in users**. [Studio page](https://studio.softr.io/applications/73913ca1-ce5d-4a96-95ac-598f361fb452/pages/fddee8d7-2790-4131-823a-555869510a36).

| Block | Block ID | Type / category | Block visibility | Reads / connections | Writes / actions |
| --- | --- | --- | --- | --- | --- |
| header1 — navigation | `d6d3da3a-db44-442c-b2a4-072ee9a46822` | STATIC / Header | All users | No table binding exposed | No record action exposed |
| item-details1 — Item details | `60876a38-6f95-4a7e-ac35-f9b219758b0d` | DYNAMIC / Item Details | All users | Saved Jobs (confirmed App MCP read) | Native action configuration unknown |
| list1 — List | `13eba775-da92-4ef3-a089-0c5be25da08a` | DYNAMIC / List | All users | Unknown: native datasource configuration omitted | Unknown: native action configuration omitted |
| list2 — List | `3e3c759b-2cf0-4c97-b01a-390572d62f4f` | DYNAMIC / List | All users | Unknown: native datasource configuration omitted | Unknown: native action configuration omitted |

### Untitled Form

Application ID: `1384742e-848f-4d0e-ba96-73b76df21c14`. Type: `FORM_APPLICATION`. 6 page entries. [Open in Studio](https://studio.softr.io/applications/1384742e-848f-4d0e-ba96-73b76df21c14).

#### List — `/list`

Page `5b40a1f4-c8ab-4bde-a659-e171af648b5c`; type `USER`; **View: Logged in users**. [Studio page](https://studio.softr.io/applications/1384742e-848f-4d0e-ba96-73b76df21c14/pages/5b40a1f4-c8ab-4bde-a659-e171af648b5c).

| Block | Block ID | Type / category | Block visibility | Reads / connections | Writes / actions |
| --- | --- | --- | --- | --- | --- |
| list1 — Horizontal card | `77696e92-5b88-45e3-9456-c5d13998c6e3` | DYNAMIC / Grid | All users | Unknown: native datasource configuration omitted | Unknown: native action configuration omitted |

#### Onboarding flow — `/onboarding`

Page `62f42d07-30cb-491f-83a4-feade3ccb6ef`; type `ONBOARDING_FLOW`; **View: Logged in users**. [Studio page](https://studio.softr.io/applications/1384742e-848f-4d0e-ba96-73b76df21c14/pages/62f42d07-30cb-491f-83a4-feade3ccb6ef).

| Block | Block ID | Type / category | Block visibility | Reads / connections | Writes / actions |
| --- | --- | --- | --- | --- | --- |
| onboarding-flow — Onboarding | `290cea2d-122f-4968-aeeb-7b68d9f40c5b` | DYNAMIC / Form | All users | Unknown: native datasource configuration omitted | Unknown: native action configuration omitted |

#### Item details — `/item-details`

Page `6c676ffd-dc9b-4351-b1d1-86a105691c15`; type `USER`; **View: Logged in users**. [Studio page](https://studio.softr.io/applications/1384742e-848f-4d0e-ba96-73b76df21c14/pages/6c676ffd-dc9b-4351-b1d1-86a105691c15).

| Block | Block ID | Type / category | Block visibility | Reads / connections | Writes / actions |
| --- | --- | --- | --- | --- | --- |
| list-details1 — Item details | `64d1a698-3f56-4a06-b4d2-aeeb2c13a9a3` | DYNAMIC / Item Details | All users | Unknown: native datasource configuration omitted | Unknown: native action configuration omitted |
| tab-container1 — Tab container | `82d82640-cb61-4717-ab41-7c5fb30bff7b` | CONTAINER / Container | All users | No table binding exposed | No record action exposed |
| tab1 — Tab | `38d7fee3-60a6-4d96-a075-46ddb2042370` | CONTAINER / Container | All users | No table binding exposed | No record action exposed |
| tab2 — Tab | `e02d9db7-6c4c-47be-9324-8d1d8e295f4e` | CONTAINER / Container | All users | No table binding exposed | No record action exposed |
| table1 — Table | `cc867040-7222-4792-b77e-55c27033df87` | DYNAMIC / Table | All users | Unknown: native datasource configuration omitted | Unknown: native action configuration omitted |

#### 6504cd8f-7fe7-4266-8dcf-800c56e9deba — `4d7d3fd7-1303-40df-be6a-186f9220bdda`

Page `9b28239f-7d95-4d74-9786-2f4176a45f88`; type `SHARED_BLOCKS`; **View: All users**. [Studio page](https://studio.softr.io/applications/1384742e-848f-4d0e-ba96-73b76df21c14/pages/9b28239f-7d95-4d74-9786-2f4176a45f88).

No blocks returned.

#### Form — `/form`

Page `aae252e3-8bb9-40ca-b7ef-a68cadc52bd2`; type `USER`; **View: Logged in users**. [Studio page](https://studio.softr.io/applications/1384742e-848f-4d0e-ba96-73b76df21c14/pages/aae252e3-8bb9-40ca-b7ef-a68cadc52bd2).

| Block | Block ID | Type / category | Block visibility | Reads / connections | Writes / actions |
| --- | --- | --- | --- | --- | --- |
| form1 — Conditional Form | `b0adea99-5291-42ba-8fe1-50b7b892d0ac` | DYNAMIC / Form | All users | Unknown: native datasource configuration omitted | Unknown: native action configuration omitted |

#### Home — `/`

Page `d106b504-0cc4-43fc-9591-35de30167daf`; type `USER`; **View: All users**. [Studio page](https://studio.softr.io/applications/1384742e-848f-4d0e-ba96-73b76df21c14/pages/d106b504-0cc4-43fc-9591-35de30167daf).

| Block | Block ID | Type / category | Block visibility | Reads / connections | Writes / actions |
| --- | --- | --- | --- | --- | --- |
| form — Standalone Form | `f4fc1a85-7667-405b-a0a3-00f3b40ed37a` | DYNAMIC / Form | All users | Unknown: native datasource configuration omitted | Unknown: native action configuration omitted |

### Native action context preserved from the initial App MCP

These capabilities were advertised for the authenticated app user. Page lists are table-level associations and do not establish which individual block owns each action. No actions were executed.

| Table | Associated pages | Advertised operations and exact labels |
| --- | --- | --- |
| Job Listings | /jobs, /job-details, /, /saved-job-details | Read; create: `Save job`, `Save job` |
| Saved Jobs | /job-details, /, /saved-job-details | Read; create: `Save job`, `Add`; update: `Drag and drop`, `Edit saved job` |
| Draft Applications | /profile, /, /saved-job-details | Read; create: `Add draft application` |
| Candidate Profile | /profile | Create: `Submit Form` |

### Custom-code blocks: wiring versus actual reads

All six custom blocks have an empty configured record-action list (`actions=[]`). Two job-list blocks query Job Listings. The custom profile block reads the logged-in user's fields through `useCurrentUser`, not Candidate Profile, and does not persist edits. The welcome block has an unused Job Listings connection. The placeholder Jobs block has attached services but renders only `EmptyStatePlaceholder`. The fixed job-details block has no datasource. These conclusions come from source/settings inspection, not a browser runtime test.

The two job lists expose search/filter controls; the small “Open roles” list navigates to `/job-details`. Only the native details block on that route is confirmed to read the selected-table data; the additional custom details block displays fixed example settings.

## 4. App users, groups, and permissions

Both apps define the same three PREDEFINED groups, with no custom groups returned. Each predefined group has `userEmails=[]`, `condition=null`, and `order=null`; these are system groups, so an empty email array does not mean zero members.

| Group | ID | Meaning |
| --- | --- | --- |
| All users | `203542f1-2f70-4d08-b360-8febd21be929` | Both anonymous and authenticated visitors, subject to page gates |
| Logged in users | `08da9dc6-6eb2-488e-8009-0e9b060297c5` | Authenticated app users |
| Non Logged in users | `b0d87082-f5ea-4c2a-a58b-22a94f48fca9` | Anonymous visitors |

### Page permissions

Every page returns **EDIT → All users** and the VIEW group listed below. No ADD or DELETE entry is returned. These are exact page-permission metadata, not proof that every visitor can edit every record: page access, block/action availability, and datasource rules still apply. Missing ADD/DELETE entries are not interpreted as an explicit deny.

| Application | Page | VIEW | EDIT |
| --- | --- | --- | --- |
| AI Job Board & Draft Applications | Sign up (`/sign-up`) | All users | All users |
| AI Job Board & Draft Applications | Page not found (`/404`) | All users | All users |
| AI Job Board & Draft Applications | Jobs (`/jobs`) | Logged in users | All users |
| AI Job Board & Draft Applications | Account settings (`/account`) | Logged in users | All users |
| AI Job Board & Draft Applications | Job Details (`/job-details`) | Logged in users | All users |
| AI Job Board & Draft Applications | Link expired (`/link-expired`) | All users | All users |
| AI Job Board & Draft Applications | Onboarding flow (`/onboarding`) | Logged in users | All users |
| AI Job Board & Draft Applications | Forgot password (`/forgot-password`) | All users | All users |
| AI Job Board & Draft Applications | Profile (`/profile`) | Logged in users | All users |
| AI Job Board & Draft Applications | Reset password (`/reset-password`) | All users | All users |
| AI Job Board & Draft Applications | 9136419c-df18-45f2-8821-ed6fa6993b3a (`/c7cdf289-efa8-4e65-b64b-847b9b60db22`) | All users | All users |
| AI Job Board & Draft Applications | Log in (`/login`) | All users | All users |
| AI Job Board & Draft Applications | Permission denied (`/401`) | All users | All users |
| AI Job Board & Draft Applications | Home (`/`) | Logged in users | All users |
| AI Job Board & Draft Applications | Saved Job Details (`/saved-job-details`) | Logged in users | All users |
| Untitled Form | List (`/list`) | Logged in users | All users |
| Untitled Form | Onboarding flow (`/onboarding`) | Logged in users | All users |
| Untitled Form | Item details (`/item-details`) | Logged in users | All users |
| Untitled Form | 6504cd8f-7fe7-4266-8dcf-800c56e9deba (`4d7d3fd7-1303-40df-be6a-186f9220bdda`) | All users | All users |
| Untitled Form | Form (`/form`) | Logged in users | All users |
| Untitled Form | Home (`/`) | All users | All users |

The job-board Sign Up and Sign In blocks additionally restrict themselves to Non Logged in users; Account Settings restricts itself to Logged in users. All other blocks use All users, within the page's VIEW gate.

### User connections

A follow-up read-only check on **2026-09-08** called `get_user_connection` once for each app. This tool exposes the connected user-field schema; it does not enumerate authentication accounts or individual account-block actions.

| Application | User-connection result | Interpretation |
| --- | --- | --- |
| AI Job Board & Draft Applications | `integrationType=SOFTR_TABLES`; 14 fields | All 14 field IDs exactly match Users (`jlY4Kuae0x2iG7`), including Email (`c63tL`), Name (`o0JWv`), Avatar (`QH0S6`), and Role (`z0b2k`). The table association is established by schema comparison; the tool does not return a table name or ID. |
| Untitled Form | `NOT_FOUND`: no users table connected | The tool explicitly reports that the app has no connected users table and cannot have condition-based user groups. Its existing predefined groups and stored page gates are still listed above. |

The six records in the connected Users table are datasource records; the builder tools do not enumerate the complete Softr authentication-user roster. Exact authentication-user count and activation states therefore remain unavailable. Users.Role has no choice labels and is independent of the three system groups. Untitled Form's `/list`, `/onboarding`, `/item-details`, and `/form` routes require Logged in users despite having no user table connected. This is a configuration gap to review; no login flow was tested, and it does not establish that the public standalone form on `/` fails.

### Global access-control summary

| Application | Data restrictions count | User-group redirects count | Sign-up redirects count |
| --- | --- | --- | --- |
| AI Job Board & Draft Applications | 0 | 1 | 1 |
| Untitled Form | 0 | 1 | 0 |

Neither app reports global data restrictions. The server returns only redirect counts, not destinations or full rules. Native block row filters/action permissions remain unavailable. The initial app-user Saved Jobs read returned all 30 records even though that user's own relation has 2; combined with zero global restrictions, this warrants checking intended user isolation, but this inventory does not claim a confirmed unauthorized-data exposure.

## 5. Workflows and automations

Two workflows are returned (`total=2`, list limit 500). They are workspace workflows and are not pinned to an application. Graphs and existing saved-test metadata were read only; no workflow trigger, API action, AI action, test_node, or workflow run was executed by this inventory. Saved successful samples are historical step evidence, not proof of current end-to-end operation.

| Workflow | State | Version metadata | Trigger | Primary target |
| --- | --- | --- | --- | --- |
| Create Draft Application | Disabled | version=1; draft=10; enabledVersion=0 | App: Run custom workflow | Draft Applications |
| Ingest job listings | Enabled | version=2; draft=0; enabledVersion=2 | Daily 07:00 America/Chicago | Job Listings |

### Ingest job listings

[Open workflow](https://studio.softr.io/workflow/5c830c7a-cdb1-4d7e-bc67-8aac1ede243c).

Enabled, published version 2, draft counter 0. Trigger is `RECURRING_SCHEDULE`, schedule **`0 0 7 * * 1-7`**. The server's node specification defines six fields (seconds, minutes, hours, day-of-month, month, weekday; 1=Monday…7=Sunday), so this runs daily at **07:00 America/Chicago**. `serialExecution=true`.

Configured flow:

1. Fetch Greenhouse boards for Anthropic, Stripe, and Figma; Fantastic.jobs active ATS jobs (24-hour window, limit 50); and two Jobven pages (limit 25 each, second page uses the first page's next cursor, with configured skill filters).
2. Read existing Job Listings. The Normalize and diff code combines sources, normalizes labels/salaries/descriptions, deduplicates external IDs, and prepares separate create/update/close queues. `maxPerRun=100` is applied to each output queue; `refreshAfterHours=6`.
3. Create Greenhouse listings after fetching/cleaning detail HTML; create ATS and Jobven listings using their normalized data. New listings are assigned Job Status=`Open`.
4. Refresh still-listed records: Job Title, Location, Source Job URL, Remote Policy, Job Status=`Open`, Last Seen At, Updated At.
5. Mark vanished **Greenhouse** listings Job Status=`Closed` and update Updated At. ATS/Jobven records are excluded from this closure rule because those feeds are windowed/paginated.

All database reads and writes target Job Listings (`OAV7rxXGxAj2a1`) in AI Job Board & Draft Applications. Create mappings include External ID, title/company/source/URL, location/work policy/employment/seniority/tags, posted/status/descriptions, and ingestion timestamps; ATS/Jobven mappings additionally cover skills and salary (ATS also company size). No delete action exists in the current graph.

### Create Draft Application

[Open workflow](https://studio.softr.io/workflow/a5608cf0-4e2c-4d28-b069-83c2f4ca142c).

**Disabled**, version 1, draft counter 10, enabledVersion 0. Trigger: `SOFTR_APPS_TRIGGER_WORKFLOW` (“Run custom workflow”), with empty trigger inputs. The exact originating app button is not exposed.

Configured flow:

1. Show a wait screen, then read Draft Applications, Saved Jobs, Job Listings, and Candidate Profile.
2. Build a queue of at most 5 **existing** drafts whose Draft Status is `In Progress` and whose Cover Letter is blank. Join each draft to its Saved Job, Job Listing, and candidate profile. Records missing the saved job or job are skipped. If the owner's profile cannot be found, the code falls back to the first profile (`profileByOwner[owner] || profiles[0]`).
3. For each queued draft, three Anthropic prompt steps generate a cover letter, match points, and short answers. Their configured model string is `anthropic-claude-sonnet-5`; availability was not tested.
4. Update that Draft Applications record: Draft Title, Cover Letter, Key Match Points, Short Answers, Missing Info Questions, Draft Status, Generated At, Updated At. The queue assigns `Needs Edits` when deterministic gap checks find missing information; otherwise `Ready for Review`.
5. Show a success interaction, then proceed to another Anthropic “Write” step using configured model `anthropic-claude-opus-5`, followed by an end-user interaction that displays a success message on either SUCCEEDED or FAILED status of that Write step.

Despite its title, the current graph contains no ADD_RECORD step to create a draft. It updates existing drafts and has no write to Saved Jobs.Status. Moving a saved job to `Draft Requested` alone is therefore not sufficient for this graph to create the missing Draft Applications record. Any separate app action supplying it remains a native-binding gap.

The final “Write” node (`f56fecb8-d3e8-42be-941a-9bc6f8e1eff0`) contains only model and integrationId, but its live node specification requires an `instruction`. It has no saved output. Some historical samples returned by the workflow belong to nodes no longer in the current graph; those were not treated as current-step failures.

### Current workflow node inventory

#### Create Draft Application

| Step | Node ID | Type | Acts on |
| --- | --- | --- | --- |
| Show wait screen | `bcdf4a0f-fbcb-4fb4-8316-7312bc5163fb` | `SOFTR_APPS_SHOW_WAIT_SCREEN` | App user interaction |
| Load pending drafts | `618d1e92-7bf3-422b-bcd6-e3da3be28c1c` | `SOFTR_TABLES_GET_RECORDS` | Draft Applications |
| Load saved jobs | `e90e2173-6cdb-4a37-a762-cbf6123c9f19` | `SOFTR_TABLES_GET_RECORDS` | Saved Jobs |
| Load job listings | `e67dd722-80c6-44d1-b3d0-291a33d40890` | `SOFTR_TABLES_GET_RECORDS` | Job Listings |
| Load candidate profile | `946e5e64-5e85-44d0-815f-ac20af433f28` | `SOFTR_TABLES_GET_RECORDS` | Candidate Profile |
| Build draft queue | `5e49b359-4db7-4f65-8571-5be0c3cd82d6` | `CUSTOM_CODE` | — |
| Generate each draft | `5abe8f8d-6ddc-4133-aaf7-ab080606b5f4` | `LOOP_ACTION_GROUP` | Nested steps below; {outputs.5e49b359-4db7-4f65-8571-5be0c3cd82d6:::$.body.queue} |
| Write cover letter | `363082f0-901c-4cc5-98d5-79b7656b30d1` | `ANTHROPIC_AI_SEND_PROMPT` | Anthropic; anthropic-claude-sonnet-5 |
| Match points and gaps | `05acfb98-195f-47ed-9c65-18cc1694c85b` | `ANTHROPIC_AI_SEND_PROMPT` | Anthropic; anthropic-claude-sonnet-5 |
| Write short answers | `3a7ff957-d3dc-4d6e-89c1-b069c36a210b` | `ANTHROPIC_AI_SEND_PROMPT` | Anthropic; anthropic-claude-sonnet-5 |
| Save generated draft | `b3a364b0-0d0f-4697-8154-acad4ff29630` | `SOFTR_TABLES_UPDATE_RECORD` | Draft Applications; fields: Draft Title, Cover Letter, Key Match Points, Short Answers, Missing Info Questions, Draft Status, Generated At, Updated At |
| End user interactions | `c118538b-1a0d-4b54-a524-f1e998c88934` | `SOFTR_APPS_END_USER_INTERACTIONS` | App user interaction |
| Write | `f56fecb8-d3e8-42be-941a-9bc6f8e1eff0` | `ANTHROPIC_AI_WRITE_TEXT` | Anthropic; anthropic-claude-opus-5 |
| End user interactions | `e8f75cf6-9365-4b2c-bf3e-5b942dfef7f9` | `SOFTR_APPS_END_USER_INTERACTIONS` | App user interaction |

#### Ingest job listings

| Step | Node ID | Type | Acts on |
| --- | --- | --- | --- |
| Fetch board A (Anthropic) | `546045d4-33a8-4f54-9850-0709fc972d41` | `CALL_API` | https://boards-api.greenhouse.io/v1/boards/anthropic/jobs |
| Fetch board B (Stripe) | `70f9b6a5-6e0c-4dc4-a018-42aa0f58c2ec` | `CALL_API` | https://boards-api.greenhouse.io/v1/boards/stripe/jobs |
| Fetch board C (Figma) | `8fcffb3d-0b0f-4902-a236-a866cd755eff` | `CALL_API` | https://boards-api.greenhouse.io/v1/boards/figma/jobs |
| Fetch ATS jobs (Fantastic direct) | `f0a56d8d-5e3a-4d65-a389-88033767927e` | `CALL_API` | https://data.fantastic.jobs/v1/active-ats |
| Fetch Jobven (page 1) | `a62296c2-9336-4ea1-ae4b-3335116c186c` | `CALL_API` | https://api.jobven.com/v1/public/jobs |
| Fetch Jobven (page 2) | `02b3bf1a-95b1-45ab-95f7-7d637809dee9` | `CALL_API` | https://api.jobven.com/v1/public/jobs |
| Load existing listings | `fab7bad8-5e82-400f-a2ba-6f1aed661a66` | `SOFTR_TABLES_GET_RECORDS` | Job Listings |
| Normalize and diff | `ecc7c65f-5f76-40d8-9192-dcbaac4f0723` | `CUSTOM_CODE` | — |
| Create new listings | `391c8a1a-725e-4aaf-9b5f-1760a1b319a3` | `LOOP_ACTION_GROUP` | Nested steps below; {outputs.ecc7c65f-5f76-40d8-9192-dcbaac4f0723:::$.body.toCreate} |
| Fetch job detail | `cc0580dd-a8c3-4e07-9f83-2c32690040c6` | `CALL_API` | {loopActionGroup.391c8a1a-725e-4aaf-9b5f-1760a1b319a3:::loopVariables.items.detailUrl} |
| Clean description | `82c92ae4-c0e4-4157-8e5d-2d9189993e4d` | `CUSTOM_CODE` | — |
| Add job listing | `20909ea5-3c5c-4188-b546-97c913a8c9f0` | `SOFTR_TABLES_ADD_RECORD` | Job Listings; fields: External ID, Job Title, Company, Source, Source Job URL, Location, Remote Policy, Employment Type, Seniority, Tags, Posted Date, Job Status, Description, Last Seen At, Created At, Updated At |
| Create ATS listings | `478159c1-a860-4ff9-86de-8b7d44bb65ec` | `LOOP_ACTION_GROUP` | Nested steps below; {outputs.ecc7c65f-5f76-40d8-9192-dcbaac4f0723:::$.body.toCreateAts} |
| Add ATS listing | `b168ffd8-0371-4d2f-bcac-d08413bb5409` | `SOFTR_TABLES_ADD_RECORD` | Job Listings; fields: External ID, Job Title, Company, Source, Source Job URL, Location, Remote Policy, Employment Type, Seniority, Tags, Required Skills, Salary Range Min, Salary Range Max, Company Size, Description, Posted Date, Job Status, Last Seen At, Created At, Updated At |
| Create Jobven listings | `d677f620-9274-4971-9d46-bb305a74bb3e` | `LOOP_ACTION_GROUP` | Nested steps below; {outputs.ecc7c65f-5f76-40d8-9192-dcbaac4f0723:::$.body.toCreateJobven} |
| Add Jobven listing | `83b5b1bb-ad58-42c7-9695-8281c3425342` | `SOFTR_TABLES_ADD_RECORD` | Job Listings; fields: External ID, Job Title, Company, Source, Source Job URL, Location, Remote Policy, Employment Type, Seniority, Tags, Required Skills, Salary Range Min, Salary Range Max, Description, Posted Date, Job Status, Last Seen At, Created At, Updated At |
| Refresh still-listed jobs | `9c2291db-8637-4e94-add6-312c5499d1fb` | `LOOP_ACTION_GROUP` | Nested steps below; {outputs.ecc7c65f-5f76-40d8-9192-dcbaac4f0723:::$.body.toUpdate} |
| Refresh listing | `1c98d64c-f43d-4d81-8b4e-fd4baf99141f` | `SOFTR_TABLES_UPDATE_RECORD` | Job Listings; fields: Job Title, Location, Source Job URL, Remote Policy, Job Status, Last Seen At, Updated At |
| Close vanished jobs | `921c0181-8c2d-4024-a6d0-f3e4748c73fb` | `LOOP_ACTION_GROUP` | Nested steps below; {outputs.ecc7c65f-5f76-40d8-9192-dcbaac4f0723:::$.body.toClose} |
| Mark listing closed | `9eee9e4d-0bcd-4c2c-be1b-86a4fb6900e2` | `SOFTR_TABLES_UPDATE_RECORD` | Job Listings; fields: Job Status, Updated At |

## 6. Publish state and domains

State below comes from `get_application`. The published job board has a publish timestamp; the form's timestamp is null. No preview was built and no publish tool was called. DNS/TLS or browser availability was not independently tested.

| Application | Publish state | Configured custom domain | Softr subdomain | Published / updated metadata |
| --- | --- | --- | --- | --- |
| AI Job Board & Draft Applications | Published | www.lakefrontdev.com | heide5790.softr.app | published=2026-09-07T05:30:55; updated=2026-09-07T05:30:55 |
| Untitled Form | Draft / unpublished (published=null) | None | lindsey92233.softr.app | published=null; updated=2026-09-07T03:37:07 |

The job-board domain is [www.lakefrontdev.com](https://www.lakefrontdev.com), with Softr subdomain `heide5790.softr.app`. Its published and updated timestamps both read `2026-09-07T05:30:55`; that equality is not a separate guarantee of no unpublished changes. The API timestamps omit a timezone, so none is invented here. Untitled Form has an assigned subdomain `lindsey92233.softr.app` but no publication timestamp.

## 7. Half-built or inconsistent areas

These findings separate confirmed stored configuration/source from possible product consequences. No fixes were made.

| Finding | Evidence level | Details |
| --- | --- | --- |
| Profile save does not persist | Confirmed source | /profile custom block `bab63294-4cf0-4eee-8d6e-1ec71631477a`: handleSave only calls toast.success and setIsEditing(false). It reads current-user data, uses a fixed San Francisco location, and has static recent-activity settings. No record mutation is implemented. |
| Fixed job details and placeholder Apply URL | Confirmed settings/source | /job-details custom block `29e50aa6-fe3f-42f6-aedc-2b5058aa8dcf` has no datasource, fixed Freddie Mac example details, and apply-link destination `#`. A separate native details block reads Job Listings. |
| Enabled placeholder block | Confirmed source | /jobs block `3ee4f8bb-4a44-49f0-b5d4-cae711244391` renders EmptyStatePlaceholder despite attached Job Listings and Anthropic connections. |
| Overlapping job-list implementations | Confirmed configuration; visual impact untested | /jobs contains two custom job lists, a native grid, three charts, and the placeholder block. All are enabled; rendered layout/nesting was not tested. |
| Draft-generation workflow disabled/incomplete | Confirmed workflow graph | Create Draft Application is disabled; its final Write step is missing required instruction, has no saved output, and can be followed by a success toast even after failure. |
| Draft workflow can choose another profile | Confirmed conditional source behavior | Build draft queue falls back to profiles[0] if no profile matches the draft owner. This can use a different candidate rather than skip; no run was executed to demonstrate it. |
| Draft Requested can exist without a draft | Confirmed record + graph | Saved Jobs record `jA6IGvsdcqrrXq` is Draft Requested with no Draft Applications link. The generation graph updates existing drafts only and does not update Saved Jobs.Status. All 4 Draft Ready records do have draft links; the earlier zero-drafts suspicion is withdrawn. |
| Incomplete profile record | Confirmed record | Candidate Profile record `xt4krgWd8iZJUN` has blank Full Name. This resolves the empty display label observed in the initial app-user datasource link. |
| Matching fields empty | Confirmed table-wide counts | All 295 Job Listings have empty Fit Score, Fit Summary, and Recommended For. No separate matching workflow was returned. Attached AI connections alone do not prove a working matching feature. |
| Minimal unused-looking form | Confirmed metadata; intent unknown | Untitled Form is unpublished. Its Form values database contains an empty Submissions table with only Auto number. Native form field/destination configuration is not exposed, so the actual form contents cannot be established. |
| Form has authenticated page gates but no user table | Confirmed user-connection response and page metadata; runtime untested | `get_user_connection` reports no users table connected for Untitled Form. `/list`, `/onboarding`, `/item-details`, and `/form` require Logged in users. Condition-based groups are unavailable; the public `/` form's runtime behavior was not tested. |
| Permissions need intended-scope review | Confirmed metadata; consequence unverified | Both apps have zero global data restrictions; every page returns EDIT=All users. Logged-in page gates remain in effect. Native block filters and action permissions are not available to confirm per-user isolation. |
| Duplicated profile attributes and empty role options | Confirmed schema | Users.Target Roles and Skills are text, while Candidate Profile counterparts are multi-select; Users.Role has no predefined labels but permits adding choices. No synchronization rule was exposed. |
| Two archive representations currently agree | Confirmed schema/records | Saved Jobs has both Status=Archived and an Archived checkbox. They agree in all 30 records, but no synchronization rule was established. |
| Save job label appears on two table targets | App MCP evidence; native binding unresolved | The initial app-user catalog advertises Job Listings.create as Save job twice and Saved Jobs.create as Save job. This could be intended or misconfigured; exact native action targets per block remain unavailable. |

## Evidence, limitations, and verification

Builder MCP evidence used: initialize/tools-list; list_applications; list_databases; list_workspaces; list_tables for both databases; get_table for all six tables; list_pages/get_page/get_page_permissions for all 21 pages; list_user_groups/get_access_control for both apps; get_user_connection for both apps in the follow-up check; get_block for one native Kanban block; settings and source for all six custom-code blocks; list_data_sources and Airtable base enumeration; list_workflows/get_workflow/get_workflow_url for both workflows; get_node_specifications; list_records for the four small populated tables; get_schema and Job Listings count aggregations.

Earlier App MCP evidence is retained only where explicitly labeled: its usedBlocks confirms three native read targets, and its operation labels give table-level action context. It did not provide complete schemas or database-wide user/profile/draft totals. The current builder inventory supersedes those earlier limitations: there are nine drafts, not zero; Full Name and all reciprocal relations are now known; app names, page names, groups, workflow graphs, and publication metadata are now available.

Remaining unexposed details are **native block datasource/action mappings**, native conditional-form fields/defaults, native row filters, the authentication-user roster/activation states, redirection destinations, and independently verified live-page behavior. Static/source conclusions are not presented as runtime tests. No native block was treated as unbound merely because the read API omitted its wiring.

The report is checked against the cached MCP responses for all table/field names and IDs, choice labels, page IDs, block IDs, and current workflow node IDs. Credentials and workflow HTTP headers are deliberately excluded.
