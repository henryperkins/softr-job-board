# Phase 7 fix round 2 scoped re-review

Date: September 11, 2026.

**Specification verdict: issues found; R5 remains open for copy consistency.**

**Code-quality verdict: needs one scoped fix.**

R1 and both remaining R7 defects are closed. R2, R3, R4, and R6 remain closed. The original-store mutation component of R5 is corrected, but its replacement introduces the concrete snapshot inconsistency below.

## Scope and frozen identity

Read the round 2 brief/report, corrected Phase 7 report, and exact eight-file frozen patch and manifest against baseline `4cf886f5901bed4c2e581b35b4d949c384cfb4e9`. Candidate: `ca3be2726ea1937d0312527792968e9c95c47a6e`. Independently verified patch size 38521 bytes and SHA-256 `bd252515e4bb03b4bc769ed891cb4f7706b6892d6fd9b079234fff8a451917c3`. Read the patch once in consecutive chunks. A final hash comparison found **zero mismatches** across all eight frozen source paths.

No source, tests, index, Git state, historical/private store, real mail/provider, cloud, localhost:8787, staging, or delegation operation was performed. Only this report was written inside the repository. One narrowly necessary synthetic external-store probe was run; no passing broad suite was repeated.

## Remaining actionable defect

### R5 — P2: copying main and WAL separately can silently omit committed data

**Location:** `scripts/ops/local-inspection.ts:54–57`.

The replacement copies the main database first, then WAL/SHM, without establishing that they belong to one stable database snapshot. The opener accepts recognized stores without requiring them to be closed or detecting concurrent checkpoint/write activity. A legitimate checkpoint between the main copy and WAL copy removes committed pages from the WAL after the copied main has already missed those pages. SQLite can open the resulting copy successfully and diagnostics silently reports stale counts or migration state.

**Deterministic synthetic reproduction:**

1. Create an external recognized D1 store, enable WAL with automatic checkpoints disabled, create `local_migrations` plus a one-column observation table, and checkpoint the schema.
2. Insert observation 1, leaving the committed row only in WAL before inspection begins.
3. Invoke the actual `openLocalInspection`. In a synthetic wrapper around Node's `fs/promises.copyFile`, perform the real main-file copy, then run `PRAGMA wal_checkpoint(TRUNCATE)` on the independent source connection before allowing the opener's normal sidecar copies. This models a legal writer/checkpointer interleaving; production source is unchanged.
4. Read the count through the returned inspection adapter.

Observed output:

```text
sourceCommittedRows 1
inspectionRows 0
checkpointBetweenCopies true
```

The opener returned success. It did not report an unstable source. The retained disposable synthetic store is `C:/Users/htper/AppData/Local/Temp/phase7-fix2-copy-race-HMywK4`.

Ensure the copied main/WAL contents represent one stable snapshot, or fail closed when the source changes during capture, while preserving the original-store immutability guarantee. Add this checkpoint-between-copies regression. The existing closed snapshot test cannot detect this interleaving because its source has no live connection. Merely narrowing the report to call the copy read-only does not prevent incorrect diagnostic results.

This is a regression in the R5 correction and falls within the review brief's explicit copy-consistency check. No deployed acceptance or staging preparation is needed to resolve it.

## Closure of the four reviewed defects

| Defect | Status | Concrete evidence |
| --- | --- | --- |
| R1 shared verification parsing | **Closed** | Both INSERT trigger predicates at `packages/data/migrations/0007_mcp.sql:82,101` now put JSON extraction inside a `CASE WHEN json_valid(...)`. The complete disconnect JSON expression is similarly protected at `workers/app/src/index.ts:317`, without relying on WHERE ordering. The epoch checks, code binding, token guards, and resource boundary remain unchanged. `tests/integration/mcp.test.ts:430` inserts a plain reset value, successfully disconnects, verifies the bearer returns 401, and proves the reset row remains. The unchanged two reset assertions now pass; the fresh security suite reports 17/17, and fresh verified-signup coverage remains in the 42/42 MCP run. |
| R5 original-store immutability | **Open overall; mutation defect corrected** | SQLite is now opened only on a temporary copy. The genuine Phase 1–6 fixture has a WAL-only committed observation, reports 0007 as missing, and hashes every original file including SHM before/after (`tests/unit/ops.test.mjs:176`). Normal success disposal and ordinary failure/cardinality paths close tracked copies and remove scratch storage. This supports closed-store immutability and WAL observation, but the live checkpoint probe above establishes an inconsistent capture path. |
| R7 installed-SDK refusal logging | **Closed** | `workers/app/src/index.ts:630–651` accepts either an allowlisted newer header or an allowlisted tool name from a cloned JSON-RPC `tools/call` envelope. Existing 256 KiB request middleware supplies the body bound. Arguments and unknown names do not enter events. The pre-callback response refusal path now receives the tool name for SDK 1.30. `tests/integration/mcp.test.ts:1214` invokes the actual installed SDK with an unknown field, asserts an error and an `mcp_tool_rejected` event with finite `invalid_request`, and asserts the argument sentinel is absent. The unchanged reviewer reproducer also reports 1/1 passed. |
| R7 dispatch reason aggregation | **Closed** | The fixed SQL CASE at `scripts/ops/diagnostics.ts:86` emits only `dispatch_unconfirmed`, `dispatch_lease_exhausted`, `none`, or `other`; the same expression groups results. `tests/unit/ops.test.mjs:456` uses actual in-memory SQLite, asserts all four distinct outputs, and proves the unexpected stored sentinel is absent. |

## Verification interpretation

Assessed the exact assertions and implementation alongside reported fresh security 17/17, MCP 42/42, operations 15/15, unchanged reviewer SDK reproducer 1/1, and passing typecheck/lint/format checks. These were not rerun. Earlier browser and Worker dry-build results are correctly attributed to round 1 rather than represented as fresh round 2 results.

The corrected reports accurately describe the R1 and R7 behavior and the absence of original-store SQL access. Their implication that copying existing sidecars always preserves a usable current snapshot needs correction with R5. Local acceptance remains separate from deployed acceptance. Staging remains stopped; this review does not start Phase 8 or impose ancillary preparation.
