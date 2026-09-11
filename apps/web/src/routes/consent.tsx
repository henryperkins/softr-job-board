import { useState } from "react";
import { api, useResource } from "../api";
import { ErrorMessage, Loading, LoadError, PageHeading } from "../components";
import { describeScope } from "../../../../packages/domain/src/mcp";

type ConnectedApp = {
  id: string;
  clientId: string;
  clientName: string | null;
  clientUri: string | null;
  verified: boolean;
  scopes: string[];
  connectedAt: number | null;
};

// A client picks its own name at registration. It is rendered as plain text,
// never as a link, an image or a badge, so a client cannot dress itself up as
// something the server has actually checked.
function ClientIdentity({
  name,
  clientId,
  uri,
}: {
  name: string | null;
  clientId: string;
  uri?: string | null;
}) {
  return (
    <div className="client-identity">
      <p>
        <strong>{name?.trim() || "Unnamed application"}</strong>
      </p>
      <p className="muted">
        Client ID <code>{clientId}</code>
      </p>
      {uri && <p className="muted">Stated website: {uri}</p>}
      <p className="muted">
        This name and website were supplied by the application itself. They have
        not been verified.
      </p>
    </div>
  );
}

function ScopeList({ scopes }: { scopes: string[] }) {
  const shown = scopes.filter((s) => s !== "openid");
  if (!shown.length) return <p className="muted">No access requested.</p>;
  return (
    <ul className="scope-list">
      {shown.map((scope) => (
        <li key={scope}>
          <code>{scope}</code> — {describeScope(scope)}
        </li>
      ))}
    </ul>
  );
}

export function Consent() {
  const query = location.search.startsWith("?") ? location.search.slice(1) : "";
  const params = new URLSearchParams(query);
  const clientId = params.get("client_id") ?? "";
  const scopes = (params.get("scope") ?? "").split(/[\s+]+/).filter(Boolean);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState<"" | "allow" | "deny">("");
  const client = useResource<Record<string, unknown>>(
    clientId
      ? `/auth/oauth2/public-client?client_id=${encodeURIComponent(clientId)}`
      : "/api/session",
  );

  // The authorization server validated the continuation and the registered
  // redirect before returning a destination. We still refuse anything that is
  // not an absolute http(s) URL rather than assigning whatever came back.
  function leave(destination: unknown) {
    const value = typeof destination === "string" ? destination : "";
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      setError(new Error("invalid_redirect"));
      return;
    }
    if (!["http:", "https:"].includes(url.protocol)) {
      setError(new Error("invalid_redirect"));
      return;
    }
    location.replace(url.toString());
  }

  async function decide(accept: boolean) {
    setBusy(accept ? "allow" : "deny");
    setError(undefined);
    try {
      const result = await api<{ redirect?: boolean; url?: string }>(
        "/auth/oauth2/consent",
        "POST",
        { accept, oauth_query: query },
      );
      leave(result.url);
    } catch (e) {
      setError(e);
    } finally {
      setBusy("");
    }
  }

  if (!clientId || !query)
    return (
      <>
        <PageHeading title="Authorization request" />
        <p className="notice error" role="alert">
          This authorization link is incomplete. Start the connection again from
          the application you want to use.
        </p>
      </>
    );

  const name =
    (typeof client.data?.client_name === "string" && client.data.client_name) ||
    (typeof client.data?.name === "string" && client.data.name) ||
    null;
  const uri =
    typeof client.data?.client_uri === "string" ? client.data.client_uri : null;

  return (
    <>
      <PageHeading
        title="Allow access?"
        description="An application is asking to use your job board account."
      />
      {client.loading && <Loading />}
      <ErrorMessage error={error} />
      <section className="panel">
        <ClientIdentity name={name} clientId={clientId} uri={uri} />
        <h2>It is asking to</h2>
        <ScopeList scopes={scopes} />
        <p className="muted">
          It acts as you, and only on your own records. You can disconnect it at
          any time from your Account page, which immediately stops its access.
        </p>
        <div className="actions">
          <button
            onClick={() => void decide(true)}
            disabled={busy !== ""}
            aria-label="Allow access"
          >
            {busy === "allow" ? "Allowing…" : "Allow"}
          </button>
          <button
            className="quiet"
            onClick={() => void decide(false)}
            disabled={busy !== ""}
            aria-label="Deny access"
          >
            {busy === "deny" ? "Denying…" : "Deny"}
          </button>
        </div>
      </section>
    </>
  );
}

export function ConnectedApps() {
  const apps = useResource<{ items: ConnectedApp[] }>("/api/connected-apps");
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  async function disconnect(app: ConnectedApp) {
    setBusy(app.id);
    setError(undefined);
    setMessage("");
    try {
      await api(`/api/connected-apps/${encodeURIComponent(app.id)}`, "DELETE");
      setMessage(
        `Disconnected ${app.clientName?.trim() || "the application"}. Its existing access stopped immediately.`,
      );
      apps.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="panel">
      <h2>Connected applications</h2>
      <p className="muted">
        Applications you allowed to use your account. Disconnecting one stops its
        access straight away.
      </p>
      <ErrorMessage error={error} />
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {apps.loading && <Loading />}
      {apps.error ? (
        <LoadError error={apps.error} retry={apps.reload} />
      ) : null}
      {apps.data?.items.length === 0 && (
        <p className="muted">No applications are connected.</p>
      )}
      <ul className="connected-apps">
        {(apps.data?.items ?? []).map((app) => (
          <li key={app.id}>
            <ClientIdentity
              name={app.clientName}
              clientId={app.clientId}
              uri={app.clientUri}
            />
            <ScopeList scopes={app.scopes} />
            <button
              className="quiet"
              onClick={() => void disconnect(app)}
              disabled={busy !== ""}
              aria-label={`Disconnect ${app.clientName?.trim() || app.clientId}`}
            >
              {busy === app.id ? "Disconnecting…" : "Disconnect"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
