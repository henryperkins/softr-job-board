### Spec Compliance

- ❌ Issues found: attachment reruns fail to preserve updated system timestamps (`scripts/migration/map-records.ts:179`); source snapshots are replaced rather than immutable (`scripts/migration/import-d1.ts:280`); the documented field-ID map does not govern runtime mapping or reject schema drift (`scripts/migration/map-records.ts:101`).
- ⚠️ Actual private 349-record/90-field export and local rehearsal aggregate results were not independently inspected, per scope. The implementer reports 26 passing tests, passing migration TypeScript, and successful local first/rerun rehearsals. Production acceptance and release gates remain explicitly pending and are not findings (`scripts/migration/reconcile.ts:244`, `task-3-report.md`, Open release gates).

### Strengths

- Attachment downloads reject redirects, constrain origins and byte counts, and keep checksum-addressed files quarantined (`scripts/migration/copy-attachments.ts:251`, `scripts/migration/copy-attachments.ts:295`).
- Target updates use a conditional write plus transaction-failing guard, and the synthetic test verifies an intervening user edit survives (`scripts/migration/import-d1.ts:149`, `tests/unit/import.test.mjs:86`).
- Local persistence uses a dedicated configuration with remote bindings disabled, while reconciliation always withholds release readiness (`scripts/migration/local-runtime.ts:68`, `scripts/migration/reconcile.ts:244`).

### Issues

#### Critical (Must Fix)

- None.

#### Important (Should Fix)

1. **P1 — Attachment change hashes omit persisted system timestamps.** `scripts/migration/map-records.ts:169` writes the parent record's `source_updated_at`, but `scripts/migration/map-records.ts:179` hashes only safe attachment metadata. After an ordinary profile edit with unchanged attachment bytes, `scripts/migration/import-d1.ts:149` skips the attachment permanently because its source hash is unchanged. A focused synthetic in-memory reproduction returned `state: rehearsed`, `changed: 1`, `unchanged: 6`, while the attachment retained `2026-09-10T11:00:00Z` instead of `2026-09-11T12:00:00Z`; reconciliation returned `TARGET_CONTENT_MISMATCH`. Include every persisted attachment source attribute, including timestamps and ownership, in its change hash and add this rerun case to the existing integration test.

2. **P1 — Historical source snapshots are overwritten.** `packages/data/migrations/0002_migration.sql:2` keys snapshots only by source identity; `scripts/migration/import-d1.ts:280` updates `fields_json`, source/target hashes, timestamps and manifest ID in place. Thus a later export destroys the prior target-side source snapshot, and prior import manifests can no longer reconstruct their retained-only fields. Users and saved jobs have no immutable content-version table to recover those values. This misses the brief's immutable-snapshot requirement. Preserve append-only snapshot versions keyed by source identity plus content hash or manifest, with a separate current-import pointer for drift and deletion bookkeeping.

3. **P1 — Stable field IDs in the disposition map are not used or validated.** `scripts/migration/map-records.ts:101` resolves values by current display name and silently reads an absent field as undefined; `scripts/migration/validate-export.ts:107` only requires a fields array and never compares it with the declared 90-field schema (`scripts/migration/field-map.json:4`). For example, renaming the existing Full Name field while retaining its ID makes mapping produce an empty profile name; a subsequent record edit imports that empty value successfully. A name collision likewise chooses the first field silently. Bind transformations to the checked field IDs, or reject changed/missing/duplicate mapping metadata before any writes; require explicit disposition for schema changes. Add a stable-ID/display-name-change regression.

#### Minor (Nice to Have)

- None.

### Assessment

**Task quality:** Needs fixes.

**Reasoning:** The local-only and quarantine boundaries are explicit and the existing tests exercise meaningful SQLite/workerd behavior. The verified attachment rerun defect, snapshot replacement, and unchecked name-based mapping prevent trusting repeatable complete migration yet.

**Checks:** Read the complete 4,037-line review patch in sequential chunks (one overlapping pagination excerpt was recovered after output truncation). Read `0001_foundation.sql` once for the named SQL interface risks: ownership foreign keys, immutable version tables, and snapshot history coverage. Ran one synthetic in-memory SQLite import/reconcile reproduction for unchanged attachment bytes after a parent timestamp update; no suites, private archives, remote writes, checkout/index changes, or external calls.
