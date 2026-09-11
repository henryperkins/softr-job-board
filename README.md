# softr-job-board

A job board built on [Softr](https://www.softr.io).

The **[workspace inventory](docs/softr-workspace.md)** documents the databases, fields,
status values, apps, pages, blocks, user permissions, workflows, and publication state
inspected on September 8, 2026, including known gaps and unfinished features.

The **[app review](docs/app-review-2026-09-11.md)** (September 11, 2026) builds on that
inventory with prioritized findings and a suggested order of work. Most urgent: the job
ingestion workflow has written nothing since September 8, and `/job-details` and `/profile`
render hardcoded example content to signed-in users.

## Working on this project with an AI assistant

The Softr workspace behind this project is reachable over the
[Model Context Protocol](https://modelcontextprotocol.io), so an AI assistant can read and
edit its apps, databases and workflows directly.

`.mcp.json` in this repo already declares the server, so Claude Code picks it up on a fresh
clone — approve the project's MCP servers when prompted, then run `/mcp` → **softr** →
**Authenticate**.

```text
MCP server URL: https://mcp.softr.io/mcp
```

Setup for Claude, ChatGPT, Codex, Cursor and other clients, plus what the authorization
screen is actually granting, is in **[docs/connect-ai-assistant.md](docs/connect-ai-assistant.md)**.

> [!WARNING]
> Granting **Full access** on Databases lets an assistant delete records, fields, tables and
> whole databases. Prefer the narrowest access that does the job.
