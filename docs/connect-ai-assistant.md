# Connect an AI assistant

This repository has two distinct MCP surfaces. Choose the one that matches the work:

| Surface                        | Identity and authority                                                       | Intended work                                                              | Status                                                                               |
| ------------------------------ | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Application user MCP           | One verified AI Jobs account, explicit OAuth consent and owner-scoped access | The user's own profiles, saved jobs, drafts and generation/review requests | Implemented and tested locally; disabled by default; no deployed endpoint is claimed |
| Softr workspace administration | Softr workspace authorization selected by an operator                        | Historical source apps, databases, workflows and publication state         | Existing external Softr service declared in `.mcp.json`                              |

## Application user MCP

The target application serves Streamable HTTP MCP at `<APP_ORIGIN>/mcp`. Replace `<APP_ORIGIN>` with the exact deployed HTTPS application origin only after an operator has verified that deployment. There is no live application URL to copy from this branch.

The server uses OAuth authorization code with S256 PKCE and opaque access tokens. Dynamic Client Registration (DCR) is supported; Client ID Metadata Documents are deliberately not advertised because the Worker does not implement the DNS-pinned metadata transport needed to fetch arbitrary client metadata safely. Clients that require a pre-registered client ID are unsupported until an operator provisions one.

### Codex CLI

The following form was checked against local `codex-cli 0.154.0` help on September 11, 2026. Codex supports Streamable HTTP OAuth and an explicit `dcr` registration choice; see the current [Codex MCP documentation](https://developers.openai.com/codex/mcp). In PowerShell:

```powershell
$McpUrl = "https://replace-with-deployed-origin.example/mcp"
codex mcp add ai-jobs --url $McpUrl --oauth-resource $McpUrl --oauth-client-registration dcr
codex mcp login ai-jobs --oauth-client-registration dcr --scopes app:read,offline_access
codex mcp get ai-jobs --json
```

The first example requests read-only access plus refresh capability. Request broader scopes only for work the user intends:

| Scope             | Capability                                                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| `app:read`        | Read shared job postings and the signed-in user's profiles, saves and drafts                                          |
| `app:write`       | Create/change the signed-in user's profiles, saves and draft text; cannot approve                                     |
| `drafts:generate` | Queue a generation request under the separate generation readiness and quota gates; does not return a completed draft |
| `drafts:review`   | Approve one exact owned draft revision                                                                                |
| `offline_access`  | Receive a rotating refresh token so the client can stay connected until access is withdrawn                           |

Codex displays the application's consent page in a browser. Confirm the client-supplied name and client ID, read each requested scope, then choose **Allow** or **Deny**. The application labels client names and websites as unverified text; it does not load a client logo or treat the stated website as trusted.

To remove access, sign in to AI Jobs, open **Account → Connected applications**, and choose **Disconnect**. This deactivates the server-side grant generation and deletes that user's pending authorization codes, consent, opaque access tokens, and refresh tokens for the client in one transaction. Code and token persistence are bound to the generation captured before provider continuation, so issuance racing with disconnect is rejected. A later explicit consent advances the generation and cannot revive an older code, intent, access token, or refresh token. Removing the local Codex configuration with `codex mcp remove ai-jobs` does not replace server-side disconnect.

Refresh tokens rotate with a strict zero-second reuse window. Reusing a rotated token is treated as replay and invalidates that rotation family; clients must retain the newest successful response and reconnect after an ambiguous retry.

Application OAuth tokens are not Softr workspace tokens and there is no application personal-token fallback. A session cookie alone cannot call MCP. `MCP_ENABLED`, `MCP_WRITES_ENABLED`, `MCP_GENERATION_ENABLED`, and `MCP_REVIEW_ENABLED` are independent application-MCP release controls; ordinary writes and generation retain their own existing gates as well.

### Other clients

A compatible client must support remote Streamable HTTP MCP, OAuth authorization code with S256 PKCE, DCR for a public client, the RFC 8707 `resource` parameter, and the server's advertised scopes. Configure the exact `<APP_ORIGIN>/mcp` resource and complete consent in the browser. Client-specific setup that has not been verified against a deployed endpoint is intentionally omitted.

## Historical Softr workspace administration

The rest of this document describes Softr's external builder/workspace MCP. It can change source apps, database schemas, records and workflows. It does not act as an AI Jobs application user, and its credentials do not authorize the new application MCP.

Source of truth for this surface: [Softr's connection guide](https://docs.softr.io/mcp/connect) and the [MCP server overview](https://docs.softr.io/mcp/overview). The dated [workspace inventory](softr-workspace.md) records what was inspected.

## Softr workspace MCP server URL

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
[personal access token using the Codex-specific setup below](#codex-token-setup).
The OAuth origin-validation error encountered with Codex CLI 0.153.4 is covered under
[Troubleshooting](#troubleshooting).

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

Use a token when your client has no OAuth support or its OAuth login fails. The Codex
connection used for the [workspace inventory](softr-workspace.md) succeeded with this
method after OAuth failed.

1. **API tokens** in your Softr account menu → **Create**. Give it a name and an expiry
   (never, 1 year, 90 days, 30 days).
2. On **Define scopes**, pick the workspaces and permissions it carries — same choices as
   the authorization screen. For a read-only inventory, choose **Applications & Forms:
   Read only**, **Databases: View only**, and **Workflows: Read only**.
3. Store the token in an environment variable named `SOFTR_WORKSPACE_TOKEN`, available to
   the process running your assistant. On Windows, open **Edit environment variables for
   your account**, add that name under **User variables**, and use the token as its value.
   Open a new terminal and fully quit and reopen desktop clients after setting it, so
   they inherit the variable.
4. Use the configuration for your client below.

### Claude Code token setup

In your local `.mcp.json`, replace the `softr` entry with this configuration. The
`"type": "http"` field is required; Claude Code 2.1.263 ignored the token example when
that field was missing. Claude Code expands `${SOFTR_WORKSPACE_TOKEN}` in headers.

```json
{
  "mcpServers": {
    "softr": {
      "type": "http",
      "url": "https://mcp.softr.io/mcp",
      "headers": {
        "Authorization": "Bearer ${SOFTR_WORKSPACE_TOKEN}"
      }
    }
  }
}
```

Start Claude Code, approve the project server if prompted, and use `/mcp` to check the
connection. See [Claude Code's environment-variable syntax](https://code.claude.com/docs/en/mcp#environment-variable-expansion-in-mcpjson).

### Codex token setup

Run this from a terminal that has `SOFTR_WORKSPACE_TOKEN` available:

```bash
codex mcp add softr --url https://mcp.softr.io/mcp --bearer-token-env-var SOFTR_WORKSPACE_TOKEN
```

Reuse the server name from your earlier registration: these examples use `softr`; use
`softr-workspace` instead if that is the name you registered. This replaces that server's
configuration. The flag takes the **environment-variable name**.

The equivalent entry in `~/.codex/config.toml` is:

```toml
[mcp_servers.softr]
url = "https://mcp.softr.io/mcp"
bearer_token_env_var = "SOFTR_WORKSPACE_TOKEN"
```

Bearer-token authentication does not require `codex mcp login`. Fully quit and reopen
the desktop client after changing its environment, then start a fresh task to load the
MCP tools. `codex mcp list` checks registration; asking the assistant to list your Softr
apps verifies an authenticated read. See [Codex MCP configuration](https://developers.openai.com/codex/mcp).

### Cursor token setup

Replace the server entry in `.cursor/mcp.json` or `~/.cursor/mcp.json` with:

```json
{
  "mcpServers": {
    "Softr": {
      "url": "https://mcp.softr.io/mcp",
      "headers": {
        "Authorization": "Bearer ${env:SOFTR_WORKSPACE_TOKEN}"
      }
    }
  }
}
```

Cursor requires the `env:` prefix for environment variables in headers. Restart Cursor
after setting the variable, then check the server connection in MCP settings. See
[Cursor's config interpolation](https://cursor.com/docs/mcp#config-interpolation).

Other clients have their own configuration formats and variable-substitution rules;
use their documented method to supply an `Authorization: Bearer` header.

> [!IMPORTANT]
> A personal access token is a credential. Keep its value in your environment and use
> only the variable reference in configuration. Never commit the literal token to this
> repo. The checked-in `.mcp.json` remains configured for OAuth; the token examples above
> are local alternatives.

## Managing and removing access

**API tokens** in your account menu is also where you take access away.

- **Personal access tokens** can be edited, regenerated or deleted.
- **Authorized apps** lists every tool connected over OAuth, with a **Revoke** button for
  each. Revoking invalidates that tool's tokens immediately. The section only appears once
  you have authorized at least one tool.

## Connecting an app instead of a workspace

This page covers connecting the _workspace_ that builds the job board. If you want the job
board's own users to work with it through their own assistant, carrying their own app
permissions, that is a different server — see
[App MCP server](https://docs.softr.io/app-mcp-server).

## Troubleshooting

- **Codex reports `OAuth authorization endpoint origin does not match the authorization server origin without issuer-bound callbacks`** — this was observed with Codex CLI
  0.153.4 during the inventory setup. Softr advertised `https://studio-api.softr.io` as
  issuer and `https://studio.softr.io/oauth/authorize` as the authorization endpoint;
  Codex rejected that combination. Follow [Codex token setup](#codex-token-setup), which
  successfully authenticated for this inventory.
- **Token variable is missing or new MCP tools do not appear** — check that the assistant
  process inherited `SOFTR_WORKSPACE_TOKEN`. After updating Windows user variables, open
  a new terminal and fully quit and reopen the desktop client, then start a fresh task.
  In Codex, `bearer_token_env_var` must contain the variable name `SOFTR_WORKSPACE_TOKEN`.
- **`claude mcp list` says "Pending approval"** — start `claude` in the repo and approve the
  project's MCP servers. Project-scoped servers stay inert until you do.
- **`claude mcp list` says "Needs authentication"** — the server is approved but you haven't
  run `/mcp` → **softr** → **Authenticate** yet.
- **Every call returns 401** — check the credential and its access. For OAuth, reconnect
  using your client's authentication flow. For a personal token, check that the variable
  is available to the client and the token is valid; replace an expired or revoked token
  in the environment and restart the client.
- **Assistant can't see a project** — the authorization screen scoped it out. Revoke under
  **Authorized apps** and reconnect with wider **Access**.
- **Assistant refuses a write** — Permissions for that area are read-only. Reconnect with
  the level you need.
