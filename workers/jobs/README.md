# Background Worker

IngestSourceWorkflow provides durable ingestion and GenerateDraftWorkflow produces extractive, review-required letters from explicitly selected profile evidence. HTTP always returns 404. The minute trigger dispatches generation; ingestion acquisition remains hourly. Ingestion scheduling/writes and generation execution are independently disabled by default.

See the [ingestion runbook](../../docs/ingestion.md) for local shadow replay and trusted operator recovery, and the [generation runbook](../../docs/generation.md) for privacy, request/attempt state, billing ambiguity, limits and the unrun model-access/human-evaluation gates. No provider key or remote resource is provisioned by these configs.

Use `pnpm test:ingestion` or `pnpm test:generation` for focused suites and `pnpm test:jobs` for both. CI runs the combined background suite. No MCP implementation is included here.
