# Connect your AI assistant to Softr

This project is built on a Softr workspace. Connecting an AI assistant to Softr's
[MCP](https://modelcontextprotocol.io) server lets it read and edit the job board's
apps, databases and workflows directly, instead of you copying values between Studio
and your editor.

Source of truth for anything not covered here: [Softr's connection guide](https://docs.softr.io/mcp/connect)
and the [MCP server overview](https://docs.softr.io/mcp/overview).

## MCP server URL

```text
https://mcp.softr.io/mcp
```

That is the only value most clients need. Nothing to install, no API key to paste —
authorization happens over OAuth in your browser.

> Working with a Softr workspace over MCP does not consume Softr AI credits. The
> assistant uses its own model and its own quota.

## Claude Code (this repo)

`.mcp.json` in the repo root already declares the server, so a fresh clone picks it up:

```json
{
  "mcpServers": {
    "softr": {
      "type": "http",
      "url": "https://mcp.softr.io/mcp"
    }
  }
}
```

1. Start Claude Code in the repo. It will ask whether to trust the project's MCP
   servers — approve `softr`.
2. Run `/mcp`, select **softr**, choose **Authenticate**. Softr's authorization screen
   opens in your browser; see [What you are approving](#what-you-are-approving).
3. Check it took: `claude mcp list` should show `softr` as connected. Before you approve
   the project it reports **Pending approval**; after approval but before authenticating,
   **Needs authentication**.

To use Softr in every project rather than only this one, add it at user scope instead:

```bash
claude mcp add --transport http --scope user softr https://mcp.softr.io/mcp
```

## Claude (web, desktop, Cowork)

1. **Customize → Connectors → + → Add custom connector**.
2. Name it `Softr`, paste `https://mcp.softr.io/mcp`, click **Continue**.
3. Claude fills in the authentication and OAuth client settings itself — leave them and
   click **Add**.
4. Click **Connect**, choose what Claude can reach, click **Allow**.

On Team and Enterprise plans only an Owner can add a custom connector. Once an Owner has
added Softr, every member connects to it themselves from the same screen.

## ChatGPT

Custom MCP servers arrive as plugins, which requires developer mode.

1. **Settings → Security and login → Developer mode**, switch it on.
2. **Plugins → +**. Name it `Softr`, keep **Connection** on **Server URL** and paste
   `https://mcp.softr.io/mcp`, leave **Authentication** on **OAuth**.
3. Tick **I understand and want to continue**, click **Create**, then **Connect**.

## Codex

The Codex CLI, the IDE extension and the ChatGPT desktop app share one MCP config, so
this is a one-time setup.

```bash
codex mcp add softr --url https://mcp.softr.io/mcp
codex mcp login softr
```

Or by hand in `~/.codex/config.toml`:

```toml
[mcp_servers.softr]
url = "https://mcp.softr.io/mcp"
```

Softr does not support OAuth Dynamic Client Registration; Codex negotiates a
[Client ID Metadata Document](https://developers.openai.com/codex/mcp) instead, which
needs no configuration. If login fails, fall back to a
[personal access token](#personal-access-tokens).

## Cursor

**Customize → MCPs → New MCP Server**, then put this in `.cursor/mcp.json` (this project
only) or `~/.cursor/mcp.json` (everywhere):

```json
{
  "mcpServers": {
    "Softr": {
      "url": "https://mcp.softr.io/mcp",
      "auth": {
        "CLIENT_ID": "4d2556b2-cfc8-4608-bd76-8dbe7e605f68"
      }
    }
  }
}
```

Cursor doesn't register OAuth clients dynamically, so it needs Softr's pre-registered
Cursor client ID. Softr appears under **Needs Attention** — click **Authenticate**.

## Other clients

Any client that supports remote MCP servers over streamable HTTP works: Mistral,
Windsurf, n8n, Zapier, your own build. Find the **MCP** / **Connector** / **Integration**
setting, add a remote server pointing at `https://mcp.softr.io/mcp`, and pick **OAuth**
if it asks for an auth method.

If the client can't register itself and asks for a Client ID, Softr has pre-registered
these. Leave the Client Secret blank — Softr's OAuth clients are public and don't use one.

| AI tool                 | OAuth Client ID                        |
| ----------------------- | -------------------------------------- |
| Claude (claude.ai)      | `db31b760-e758-4f52-b15b-93b0262a1290` |
| Cursor (cursor.com)     | `4d2556b2-cfc8-4608-bd76-8dbe7e605f68` |
| ChatGPT (chatgpt.com)   | `aa73bf7b-c5b6-4031-b771-25108bf6c132` |
| Mistral AI (mistral.ai) | `522bfc02-e64f-43cd-87ef-552507ecb967` |

For anything else, use a [personal access token](#personal-access-tokens).

## What you are approving

However you connect, the last step is the same Softr screen. **Access** picks which
projects the tool can reach; **Permissions** sets what it can do in each of three areas —
Applications & Forms, Databases, Workflows. The assistant cannot request permissions in
advance: you choose them here, and you can change or revoke them later.

The server advertises these OAuth scopes:

```text
applications:read        applications:write
databases.records:read   databases.records:write   databases.schema:write
workflows:read           workflows:write           workflows:execute
```

> [!WARNING]
> **Full access** on Databases lets an assistant delete records, fields, tables and whole
> databases. For a connection that can never delete anything, set Databases to
> **View only**. See [Deleting data](https://docs.softr.io/mcp/databases#deleting-data).

Suggested starting point for this repo: grant access to the job board project only, with
Databases at the lowest level that still lets you do the task at hand. Widen it when you
actually need to, rather than by default.

## Personal access tokens

Use a token when you are building your own MCP client, or connecting a tool with no OAuth
support.

1. **API tokens** in your Softr account menu → **Create**. Give it a name and an expiry
   (never, 1 year, 90 days, 30 days).
2. On **Define scopes**, pick the workspaces and permissions it carries — same choices as
   the authorization screen.
3. Send it as a bearer token:

```json
{
  "mcpServers": {
    "softr": {
      "url": "https://mcp.softr.io/mcp",
      "headers": {
        "Authorization": "Bearer ${SOFTR_API_TOKEN}"
      }
    }
  }
}
```

> [!IMPORTANT]
> A personal access token is a credential. Keep it in an environment variable as shown
> above — never commit the literal token to this repo. The checked-in `.mcp.json` uses
> OAuth precisely so there is no secret to leak.

## Managing and removing access

**API tokens** in your account menu is also where you take access away.

- **Personal access tokens** can be edited, regenerated or deleted.
- **Authorized apps** lists every tool connected over OAuth, with a **Revoke** button for
  each. Revoking invalidates that tool's tokens immediately. The section only appears once
  you have authorized at least one tool.

## Connecting an app instead of a workspace

This page covers connecting the *workspace* that builds the job board. If you want the job
board's own users to work with it through their own assistant, carrying their own app
permissions, that is a different server — see
[App MCP server](https://docs.softr.io/app-mcp-server).

## Troubleshooting

- **`claude mcp list` says "Pending approval"** — start `claude` in the repo and approve the
  project's MCP servers. Project-scoped servers stay inert until you do.
- **`claude mcp list` says "Needs authentication"** — the server is approved but you haven't
  run `/mcp` → **softr** → **Authenticate** yet.
- **Every call returns 401** — the token expired or the app was revoked. Re-authenticate
  from `/mcp`.
- **Assistant can't see a project** — the authorization screen scoped it out. Revoke under
  **Authorized apps** and reconnect with wider **Access**.
- **Assistant refuses a write** — Permissions for that area are read-only. Reconnect with
  the level you need.
