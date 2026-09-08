# softr-job-board

A job board built on [Softr](https://www.softr.io).

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
