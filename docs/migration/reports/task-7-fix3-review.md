# Phase 7 final scoped re-review: R5 copy consistency

Date: September 11, 2026.

**Specification verdict: PASS for the remaining local R5 requirement.**

**Code-quality verdict: PASS; no actionable defect found in the scoped correction.**

**R5 is closed. All original Phase 7 findings R1–R7 are now closed for local acceptance.** Prior closures were preserved rather than re-audited. This is not deployed acceptance and authorizes no staging or production work.

## Frozen review boundary

Reviewed the final R5 brief, fix-round report, corrected consolidated report, four-file patch and manifest. Base tree: `ca3be2726ea1937d0312527792968e9c95c47a6e`; candidate: `2bce5e5367f7e28ae3f8263910f23e12968ff440`.

Independently verified the 15597-byte patch SHA-256: `3b53390116e28b878db4004a6da87f06d9e2e3b9a103b0f90c2bf2df2b532681`. Read the patch once. The final read-only hash comparison found **zero mismatches across all four candidate source files**.

No source/test/index/Git changes, private historical store access, real mail/provider/cloud/staging operations, localhost:8787 changes or delegation occurred. Only this review report was written.

## Why the checkpoint defect is closed

`scripts/ops/local-inspection.ts:29–80` fingerprints the main database and the presence/content of both sidecars before copying. Each attempt copies exactly the observed set into its own disposable directory, then fingerprints both the source and captured set. Acceptance requires the source-before, source-after and copied hashes to match.

This directly rejects the previously demonstrated sequence: the source checkpoint changes the main/WAL hashes after the old main file is copied, so the first capture cannot be opened or returned as a successful stale inspection. The next stable capture includes the checkpointed data.

The implementation is bounded to **three total capture attempts** (`:18,54`). A missing observed file makes the attempt incomplete; changed attempts are removed (`:77`). Three unstable attempts produce an explicit stop-writers-and-retry error (`:79–80`). The surrounding failure path removes scratch storage (`:133–136`). SQLite opens only an accepted temporary copy (`:123–124`), and normal disposal closes the copy and removes scratch storage (`:161–164`). Original files are only read/copied.

## Assertion and verification evidence

The deterministic test at `tests/unit/ops.test.mjs:203` uses an independent real SQLite connection with a committed row only in WAL. Its filesystem hook performs the actual main-file copy and then checkpoints the source before the sidecar copies. It asserts the interleaving occurred and inspection returns the committed row. The reported RED result reproduced 0 inspected rows versus 1 committed row; the unchanged test then passed GREEN after stability detection.

The existing stable Phase 1–6 fixture at `tests/unit/ops.test.mjs:177` continues to assert the WAL-only observation is present, 0007 remains the sole pending migration, and the complete original file set/content—including SHM—is unchanged (`:196`). These assertions cover the accepted stable path as well as the corrected checkpoint path.

Assessed the reported fresh operations **16/16 PASS**, migration typecheck PASS and focused formatting PASS against the actual changes and assertions. No unresolved concrete doubt justified another probe, and no passing suite was rerun. The corrected consolidated report accurately attributes security/MCP results to round 2 and browser/dry-build results to round 1.

Staging remains stopped. No additional preparation, broad audit or Phase 8 work is a condition of this local approval.

