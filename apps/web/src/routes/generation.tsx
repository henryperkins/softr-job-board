import { useEffect, useState } from "react";
import { api, type Draft } from "../api";
import { ErrorMessage } from "../components";
type RequestState = {
  id: string;
  state: string;
  failureCode: string | null;
  draftId: string;
  profileVersionId: string;
  model: string;
  contract: string;
  expectedRevision: number;
  dispatch: {
    state: string;
    attempts: number;
    failureCode: string | null;
  } | null;
  review: null | {
    evidence: { id: string; text: string; source: string }[];
    gaps: string[];
    reviewNote: string;
  };
};
type Options = {
  enabled: boolean;
  jobVersionId: string | null;
  profiles: {
    profileId: string;
    versionId: string;
    revision: number;
    name: string;
  }[];
  requests: RequestState[];
};
export function GenerationPanel({
  savedJobId,
  draftId,
  onCreated,
}: {
  savedJobId: string;
  draftId?: string;
  onCreated: (id: string) => void;
}) {
  const [data, setData] = useState<Options>(),
    [version, setVersion] = useState(""),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID()),
    [message, setMessage] = useState("");
  useEffect(() => {
    let live = true;
    const load = () =>
      void api<Options>(
        "/api/saved-jobs/" + encodeURIComponent(savedJobId) + "/generation",
      )
        .then((v) => {
          if (live) setData(v);
        })
        .catch((e) => {
          if (live) setError(e);
        });
    load();
    const timer = setInterval(load, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [savedJobId]);
  async function request() {
    const chosen = data?.profiles.find((p) => p.versionId === version);
    if (!chosen || !data?.jobVersionId) return;
    setBusy(true);
    setError(undefined);
    setMessage("");
    try {
      const target = draftId
        ? await api<Draft>("/api/drafts/" + encodeURIComponent(draftId))
        : null;
      const accepted = await api<RequestState>(
        "/api/generation-requests",
        "POST",
        {
          savedJobId,
          profileId: chosen.profileId,
          profileVersionId: chosen.versionId,
          jobVersionId: data.jobVersionId,
          idempotencyKey: key,
          ...(target
            ? { draftId: target.id, expectedRevision: target.revision }
            : {}),
        },
      );
      setData({
        ...data,
        requests: [
          accepted,
          ...data.requests.filter((r) => r.id !== accepted.id),
        ],
      });
      setMessage(
        "Request accepted and queued. Your existing text remains available. No application was submitted.",
      );
      setKey(crypto.randomUUID());
      if (!draftId) onCreated(accepted.draftId);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  const pending = data?.requests.some((r) =>
    ["queued", "running"].includes(r.state),
  );
  return (
    <section className="panel">
      <h2>
        {data?.enabled ? "Draft generation" : "Draft generation is unavailable"}
      </h2>
      <p>
        Creates a letter from exact quotations of your selected profile claims.
        The model selects evidence; a fixed template formats the letter. Review
        every claim and the letter’s tone before approving.
      </p>
      {!data?.enabled && (
        <p className="notice">
          New generation is not configured. Existing drafts remain editable and
          reviewable.
        </p>
      )}
      <ErrorMessage error={error} />
      <label className="field">
        <span>Profile and immutable version</span>
        <select
          aria-label="Profile and immutable version"
          value={version}
          onChange={(e) => {
            setVersion(e.target.value);
            setKey(crypto.randomUUID());
          }}
        >
          <option value="">Choose a profile version</option>
          {data?.profiles.map((p) => (
            <option key={p.versionId} value={p.versionId}>
              {p.name} · version {p.revision}
            </option>
          ))}
        </select>
      </label>
      <p className="small muted">
        Resume contents are not used. File extraction is unavailable; add the
        relevant evidence to your profile and choose that version. Quarantined
        uploads cannot be used.
      </p>
      {data?.enabled && !data.jobVersionId && (
        <p>
          A current immutable job version is unavailable. Generation cannot
          start for this listing.
        </p>
      )}
      <button
        className="primary"
        disabled={
          !data?.enabled || !version || !data.jobVersionId || busy || pending
        }
        onClick={() => void request()}
      >
        {busy
          ? "Requesting…"
          : draftId
            ? "Regenerate selected draft"
            : "Request draft"}
      </button>
      {message && <p role="status">{message}</p>}
      {data?.requests.map((r) => (
        <article key={r.id} className="notice">
          <p role="status">
            Generation: {r.state}
            {r.failureCode ? " · " + r.failureCode.replaceAll("_", " ") : ""}
          </p>
          <p className="small muted">
            Selected profile version: {r.profileVersionId}. Model: {r.model}.{" "}
            {r.contract}. Target revision {r.expectedRevision}.
          </p>
          {r.dispatch && (
            <p className="small muted">
              Dispatch: {r.dispatch.state} · {r.dispatch.attempts} attempt(s)
              {r.dispatch.failureCode
                ? " · " + r.dispatch.failureCode.replaceAll("_", " ")
                : ""}
            </p>
          )}
          {r.state === "succeeded" && (
            <p>
              The generated revision is ready. Use “Compare latest draft” below
              to review it while keeping your unsaved text.
            </p>
          )}
          {r.failureCode === "provider_acceptance_unknown" && (
            <p>
              Provider acceptance is unknown. This request will not make another
              provider call automatically. A new request may incur another
              charge.
            </p>
          )}
          {r.review && (
            <details>
              <summary>Evidence, gaps and required review</summary>
              <p>{r.review.reviewNote}</p>
              <ul>
                {r.review.evidence.map((e) => (
                  <li key={e.id}>
                    <strong>{e.id}</strong> · {e.source}
                    <blockquote>{e.text}</blockquote>
                  </li>
                ))}
              </ul>
              <ul>
                {r.review.gaps.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            </details>
          )}
        </article>
      ))}
    </section>
  );
}
