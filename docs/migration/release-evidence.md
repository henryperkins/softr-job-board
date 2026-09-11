# Release evidence gates

Release evidence is collected in two phases because the first accepted target write is the rollback boundary. Missing future evidence must never be invented to make a preflight command pass.

## Pre-write authorization checklist

Complete and review this checklist before enabling target writes. This is a human-reviewed gate; the post-write checker below is intentionally not a preflight validator.

- Record the exact full Git SHA, clean candidate tree, operator, environment and preparation time.
- Run and record the exact lint, typecheck, unit, integration, background-worker, browser and both Worker dry-build commands against that SHA.
- Record the proposed application/background Worker names and candidate version/build identifiers, dedicated D1 database ID, every private R2 bucket, the effective email binding/sender, and the hash of each migration in the exact candidate.
- Verify staging restore, controlled-user isolation, transactional email delivery, OAuth consent/revocation, and all required parity rows against the exact deployed staging versions.
- Keep `WRITES_ENABLED`, `GENERATION_ENABLED`, `MCP_ENABLED`, `MCP_WRITES_ENABLED`, `MCP_GENERATION_ENABLED`, and `MCP_REVIEW_ENABLED` off until each named capability is authorized. Keep target scheduling off. A readiness decision does not enable a switch.
- Capture the source writer inventory and effective Softr application/MCP/workflow state. Freeze every source writer, let in-flight work settle, and record the freeze time plus the last accepted source write.
- Produce and hash the final source export and attachment manifest after the freeze. Reconcile counts, relationships, identities, attachment bytes and reviewed exceptions without assuming rehearsal totals are current.
- Import/reconcile D1 and private R2 with target writes off. Record the D1 bookmark, migration ledger, resource IDs and reconciliation result.
- Record current and proposed apex/`www` DNS, Worker routes and Custom Domains, including all unrelated records and every other consumer of `lakefrontdev-origin-proxy`.
- Rehearse and record both rollback branches from [rollback.md](rollback.md): before any target write and after a target write. The after-write branch must preserve accepted target data.
- Obtain explicit authorization for the exact deployment/routing/write-enable action. A completed checklist authorizes nothing by itself.

At this point `firstAcceptedTargetWriteAt` does not exist. Leave it absent in pre-write evidence. Do not put a forecast timestamp into a manifest and do not run the post-write checker as proof of preflight.

## Post-write closeout manifest

After an authorized release accepts its first bounded target write, copy [release-evidence-post-write.template.json](release-evidence-post-write.template.json) to the protected release-evidence location outside the repository. Replace every `REPLACE_*` and `UNPROVISIONED_*` value with evidence observed from the exact release. Never store tokens, credentials, private record content or provider output in the manifest.

The manifest records:

- exact Git SHA and completed local checks;
- deployed application/background Worker version IDs and dedicated resource IDs;
- D1 bookmark, deployed restore/isolation/mail verification times and exact migration hashes;
- effective release flags;
- frozen-source export and attachment hashes;
- last accepted source write and first accepted target write;
- before/after routing and preservation of unrelated records.

Validate the completed closeout record with:

```bash
node scripts/ops/release-evidence.ts <completed-post-write-manifest.json>
```

The checker fails for missing fields, placeholders, failed local checks, mismatched migration files, overlapping source/target write windows, or a production manifest that says writes were never enabled. Therefore the supplied template is expected to fail until real post-write evidence replaces every placeholder.

A `PASS` means only that the closeout record is structurally complete and matches the migrations in the current checkout. It does not prove the statements are true, authorize deployment, switch DNS, enable a flag, restore D1, or retire Softr. Review the referenced evidence and follow [cutover.md](cutover.md) and [rollback.md](rollback.md).

## Redacted local diagnostics

For a recognized local migration store, collect bounded counts and ages with:

```bash
node scripts/ops/diagnostics.ts <recognized-local-store>
```

The fixed queries report source observation age; ingestion runs and backlog grouped by state/action; outbox kind/state, the allowlisted `dispatch_unconfirmed` and `dispatch_lease_exhausted` reasons plus finite `none`/`other` fallbacks, age and attempts; generation request/attempt state and token-usage totals; repository-versus-ledger migration drift; attachment/review totals; and OAuth grant counts. The command requires an existing recognized rehearsal store and copies its D1 database plus any WAL/SHM sidecars into disposable storage before opening SQLite. It hashes the source set before and after copying and accepts only a captured set whose hashes match; after three unstable attempts it fails and asks the operator to stop writers. It never creates or changes the original store, rewrites configuration, or applies a migration. It does not read record content, user identifiers, bearer tokens or provider output. Rejected authorization and tool dispatch/validation are counted from finite structured Worker logs; alert thresholds are deployment choices rather than an invented SLO.
