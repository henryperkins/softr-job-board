# Task 3: migration implementation and local rehearsal
Scope: repeatable read-only Softr export, validation, 90-field disposition map, private file capture, constrained D1 importer, local R2 quarantine copy and reconciliation. No remote writes, emails, account activation, deployment or cutover.

## Implementation
scripts/migration/export-softr.ts uses installed MCP SDK and fixed official endpoint with environment-only token. Administrative roster and every table page are collected with count/duplicate/pagination guards. The export is explicitly not quiescent or transactionally consistent. New archives are outside the repository with restrictive Windows ACLs; raw rows/auth roster and signed URLs are not in the public tree.
validate-export.ts checks all five tables, identities, dates, status/archive consistency, owner/save/draft relationships, unsafe source URLs and auth correlation. Structural validity never equals cutover readiness.
copy-attachments.ts uses allowlisted HTTPS host with redirects rejected, bounded timeout/bytes, signature/size/hash checks, content-addressed local bytes and owner-specific references; checkpoint resume detects local corruption and stale terminated-process locks.
map-records.ts and field-map.json preserve all90 field identities and values, separating source timestamps, quarantined attachment metadata and imported business roots; raw attachment URLs/thumbnails remain only in archive. Unknown values remain unknown; legacy draft provenance stays legacy; no active profile or identity is inferred.
import-d1.ts uses stable legacy IDs and per-record atomic roots/immutable versions/maps/snapshots/audits. Existing target hashes and concurrent conditional updates protect user edits. Removed source records/roster identities create pending dispositions and retain target evidence. Reruns skip unchanged records; read batches bound D1 parameters90 and avoid serial read round trips.
local-runtime.ts uses dedicated config, local persistence outside repo and explicit remoteBindings:false, not production app config. Schema hashes prevent silently changing an applied migration. 0002_migration.sql contains snapshots/roster/dispositions/write guards.
reconcile.ts checks expected mapped content, every source snapshot, legacy mapping, latest version existence, D1 foreign keys, counts, auth roster metadata and actual R2 byte checksums; copied attachments remain pending scan and unavailable to app downloads.
rehearse.ts imports/copies/reconciles into local-only D1/R2 and writes detailed reports only to the protected store. Stdout contains aggregates.

## Evidence
- 26 Node tests pass: paginator/validator/file resume and origins, real SQLite transaction/owner/drift/deletion tests, plus actual local workerd D1/R2 missing/corrupt-byte/rerun test.
- Migration strict TypeScript config passes.
- Actual CLI re-export: Users6, Profiles9, Jobs295, Saved30, Drafts9 =349, complete roster6, inventoryChangedDuringExport false; quiescent false.
- Actual file capture:26 references, six unique byte streams, all declared sizes/types match; source-reference bytes451499.
- First local rehearsal:375 imported roots including26attachment rows;26R2 objects copied; structurallyReconciled true; no issues.
- Second local rehearsal:changed0,unchanged375;copied0,unchanged26;structurallyReconciled true;noissues.
- All source identities remain unclaimed; auth_identities0, active_profiles0. No scanner was configured; scanStatus pending/available0.
- Source archive and local target are under task work/private-source, outside repo; public reports retain only aggregate facts.

## Open release gates
Final frozen export, native Softr acceptance using two controlled identities, explicit legacy claims/ambiguous duplicated profile-field disposition, malware scanning, real mail delivery, provider entitlements, staging/private downloads and exact deployment verification remain open. Importing quarantined bytes locally does not meet file release gate. Source deletion conflicts require reviewed dispositions; no automatic deletion switch exists. Future remote import must wrap the same service with explicitly verified environment/account IDs; this CLI intentionally exposes local rehearsal only.


## Fix round1
Review found attachment hashes omitted persisted timestamps/ownership, mutable current pointers lacked separate immutable source history, and field transformations did not verify90-field metadata. Fixed with full attachment-core/source hash, additive0004 append-only legacy_snapshot_versions/import_record_versions (including auth roster history), and checked field-ID/name/type contract with schema-change quarantine before writes. Renamed/colliding/missing fields require explicit contract review; they never clear mapped data silently. Reconciliation now verifies immutable history and compares JSON semantically. Test fixtures with generic table IDs remain library-only; authoritative application/database/table identities are checked when present.
Red evidence: renamed Full Name imported instead of blocked; no immutable history table; reviewer reproduced stale attachment timestamp. Focused10tests now pass with real SQLite history and actual local workerd D1/R2 timestamp rerun. Migration TypeScript passes. Actual protected target upgraded additively,349businessroots unchanged,26attachment hashes advanced to complete contract, all26R2objects unchanged, structural reconciliation/history checks pass with noissues. Cutover readiness remainsfalse.

## Fix round2
Scoped review approved the original3fixes but found A->B->A archive replay reused A's immutable membership with new target revisions. Added pre-write membership guard: reusing an already-imported snapshot whose previously written rows now differ is STALE_EXPORT_REPLAY, before any business or manifest writes. Partial imports still resume rows they never wrote. Rollback requires the separate reviewed rollback procedure or fresh rehearsal store; normal import is not an implicit rollback. Red regression replayed oldA as rehearsed; now10focused importer tests pass with existing current snapshots unchanged after rejected replay. Strict migrationTypeScript passes.
