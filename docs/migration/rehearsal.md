# Export and local migration rehearsal

These commands read the selected Softr application and write to a protected archive and a dedicated local D1/R2 emulator. They do not import credentials, activate identities, scan documents, deploy resources, or establish a frozen source snapshot. Run from the repository root with Node 24 and the pinned pnpm dependencies installed.

## Capture and validate

The exporter reads `SOFTR_WORKSPACE_TOKEN` from the environment and connects only to the official builder MCP endpoint. Supply the existing secret through the environment; never place it in a command argument or repository file. Choose a new directory outside the repository. The exporter refuses an existing directory, removes inherited Windows permissions, and grants access to the current user.

```powershell
$sourceArchive = 'C:\migration-private\source-20260911'
$targetRehearsal = 'C:\migration-private\target-20260911'
pnpm migration:export --out-dir $sourceArchive
pnpm migration:validate --manifest "$sourceArchive\source-export.json" --report "$sourceArchive\validation.json"
pnpm migration:attachments --manifest "$sourceArchive\source-export.json"
pnpm migration:rehearse --manifest "$sourceArchive\source-export.json" --local-store $targetRehearsal
```

The examples require an existing private parent directory; they do not prescribe a production storage location. Detailed reports contain source identifiers and must remain protected. Console output contains counts and issue categories. CI uses synthetic fixtures only.

The source export includes all pages from the five business tables, their complete field metadata and system timestamps, the administrative authentication roster, and inventories before and after capture. Export and per-record hashes accompany it. Inventory agreement does not prove that source writers were frozen or that a multi-page export was transactionally consistent.

Validation checks the reviewed 90-field contract and relationships before any import. A renamed, missing, colliding or unexpectedly typed production field blocks import until the mapping and contract are deliberately reviewed. Invalid dates, ambiguous owners, status/archive conflicts, duplicate saves and identity correlation conflicts also block import.

## Files and repeatability

Attachment downloads use the approved source host, validate actual file signatures and declared sizes, and record SHA-256 checksums. They reject redirects and oversized responses. A resumable manifest tracks every reference; shared byte streams are deduplicated in the source archive, then written under distinct immutable owner-specific keys in local private R2. All imported documents remain quarantined with scan status pending. A matching checksum does not imply safe content.

Repeat `migration:attachments` to resume a failed byte transfer. Repeat the rehearsal command against the same source and target to verify zero logical changes and no duplicate versions. `migration:reconcile` is an alias for this idempotent local import-and-reconcile operation, not a read-only production inspector.

```powershell
pnpm migration:reconcile --manifest "$sourceArchive\source-export.json" --local-store $targetRehearsal
```

The target marker and generated configuration select local bindings only; remote bindings and dotenv loading are disabled. SQL migrations are applied in numeric order with a checksum registry. If an already applied migration changes, use a new rehearsal store instead of editing its recorded checksum.

Each source record has a stable target identifier, an immutable source snapshot, manifest membership, and a current pointer. Full source fields are retained, including fields deliberately excluded from current product behavior. Attachment bearer URLs stay in the protected source archive and are removed from target metadata. Imported drafts remain legacy content with unknown generation provenance. Imported authentication roster entries do not create Better Auth accounts or resource access.

Subsequent exports preserve source history and create versions only when mapped content changes. An optimistic condition blocks an import that would overwrite target edits. A source deletion creates a disposition and marks source presence; it does not silently delete a target user's data. Replaying archive A after newer archive B has replaced one of A's records is rejected before writes. Restore/rollback is a separate reviewed operation, not an old import replay.

## Evidence and limits

The September 11 local rehearsal reconciled 349 business records, all 90 source fields, six administrative roster entries and 26 attachment references. Its final repeat changed zero of 375 mapped roots, copied zero additional objects and verified all 26 stored byte streams. Detailed reconciliation checked relationships, source/target hashes, immutable snapshot membership, version references, and actual R2 bytes. That import did not scan files or activate identities.

A subsequent local ClamAV 1.5.4 scan at 14:52 UTC used verified official databases and returned zero detections for the six unique archived files, with original checksums unchanged. Its harmless detection/clean/error controls returned the expected results. The [evidence manifest](evidence-manifest.md) records the scanner and protected report. All imported attachment records remain quarantined: no D1/R2 state was changed and no automatic quarantine-release workflow or deployed scan acceptance is claimed.

A successful result reports `structurallyReconciled: true` and still reports `releaseReady: false`. Final cutover additionally needs a reliable source write freeze, fresh export, reviewed data retention, fresh-account authentication, file scanning, real staging checks, and the explicit deployment action in the [cutover runbook](cutover.md). Use the [evidence manifest](evidence-manifest.md) for the current acceptance status.

Account migration was subsequently excluded by the user. This full-data rehearsal remains archival evidence; fresh target accounts are not linked to its historical private owners.
