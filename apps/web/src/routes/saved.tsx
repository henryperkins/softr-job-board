import { useState, type FormEvent } from "react";
import { api, useResource, type Saved, type Draft } from "../api";
import { GenerationPanel } from "./generation";
import {
  ErrorMessage,
  Field,
  TextArea,
  LoadError,
  Loading,
  PageHeading,
  StatusSelect,
} from "../components";
type Version = {
  id: string;
  revision: number;
  coverLetter: string | null;
  shortAnswers: string | null;
  reviewerNotes: string | null;
  status: string;
  createdAt: string;
};
function DraftEditor({ id }: { id: string }) {
  const result = useResource<Draft>("/api/drafts/" + id);
  if (result.loading) return <Loading />;
  if (result.error)
    return <LoadError error={result.error} retry={result.reload} />;
  return <DraftForm key={id} initial={result.data!} />;
}
function DraftForm({ initial }: { initial: Draft }) {
  const [latest, setLatest] = useState<Draft>();
  const [draft, setDraft] = useState(initial),
    [coverLetter, setCover] = useState(initial.coverLetter ?? ""),
    [shortAnswers, setAnswers] = useState(initial.shortAnswers ?? ""),
    [reviewerNotes, setNotes] = useState(initial.reviewerNotes ?? ""),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const history = useResource<{ items: Version[] }>(
    "/api/drafts/" + draft.id + "/history",
  );
  const dirty =
    coverLetter !== (draft.coverLetter ?? "") ||
    shortAnswers !== (draft.shortAnswers ?? "") ||
    reviewerNotes !== (draft.reviewerNotes ?? "");
  async function submit(approve = false) {
    setBusy(true);
    setError(undefined);
    setMessage("");
    try {
      const saved = await api<Draft>(
        "/api/drafts/" + draft.id + (approve ? "/approve" : ""),
        approve ? "POST" : "PATCH",
        approve
          ? { expectedRevision: draft.revision }
          : {
              expectedRevision: draft.revision,
              coverLetter,
              shortAnswers,
              reviewerNotes,
            },
      );
      setDraft(saved);
      setMessage(
        approve
          ? "Draft explicitly approved. No application was submitted."
          : "Draft edits saved as a new revision.",
      );
      history.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>Review draft</h2>
      <p className="muted">
        {draft.status ?? "Unknown status"} · Revision {draft.revision} ·{" "}
        {draft.executionStatus} · {draft.provenance} source
      </p>
      {draft.approvedRevision !== null && (
        <p>Last approved revision: {draft.approvedRevision}</p>
      )}
      <ErrorMessage error={error} />
      <button
        type="button"
        onClick={() =>
          void api<Draft>("/api/drafts/" + draft.id)
            .then(setLatest)
            .catch(setError)
        }
      >
        Compare latest draft
      </button>
      {latest && (
        <div className="notice">
          <p>
            Latest saved revision {latest.revision}. Your editor text is
            retained below.
          </p>
          <pre style={{ whiteSpace: "pre-wrap" }}>{latest.coverLetter}</pre>
          <button
            type="button"
            onClick={() => {
              setDraft(latest);
              setCover(latest.coverLetter ?? "");
              setAnswers(latest.shortAnswers ?? "");
              setNotes(latest.reviewerNotes ?? "");
              setLatest(undefined);
              setError(undefined);
            }}
          >
            Load latest draft into editor (replaces unsaved text)
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(latest);
              setLatest(undefined);
              setError(undefined);
              setMessage(
                "Your text is retained against the latest revision. Compare changes before saving.",
              );
            }}
          >
            Keep my text against latest revision
          </button>
        </div>
      )}
      {!!error && (
        <a
          href={location.pathname + location.search}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open latest saved job in a new tab
        </a>
      )}
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <TextArea
          label="Cover letter"
          value={coverLetter}
          onChange={setCover}
          maxLength={100000}
        />
        <TextArea
          label="Short answers"
          value={shortAnswers}
          onChange={setAnswers}
          maxLength={50000}
        />
        <TextArea
          label="Reviewer notes"
          value={reviewerNotes}
          onChange={setNotes}
        />
        <div className="actions">
          <button
            disabled={
              busy ||
              !dirty ||
              (["queued", "running"].includes(draft.executionStatus) &&
                draft.provenance !== "generation")
            }
            className="primary"
          >
            Save draft edits
          </button>
          <button
            type="button"
            disabled={
              busy ||
              dirty ||
              !["Ready for Review", "Needs Edits"].includes(
                draft.status ?? "",
              ) ||
              ["queued", "running"].includes(draft.executionStatus) ||
              !(draft.coverLetter?.trim() || draft.shortAnswers?.trim())
            }
            onClick={() => void submit(true)}
          >
            Approve this revision
          </button>
        </div>
        {dirty && (
          <p className="small muted">
            Save your edits before explicitly approving this revision.
          </p>
        )}
      </form>
      <hr />
      <h3>Review history</h3>
      {history.loading ? (
        <Loading />
      ) : history.error ? (
        <LoadError error={history.error} retry={history.reload} />
      ) : !history.data?.items.length ? (
        <p className="muted">No retained draft versions are available.</p>
      ) : (
        history.data.items.map((v) => (
          <details key={v.id}>
            <summary>
              Revision {v.revision} · {v.status ?? "Unknown"}
              {v.revision === draft.approvedRevision ? " · Last approved" : ""}
            </summary>
            <p className="small muted">
              {new Date(v.createdAt).toLocaleString()}
            </p>
            <h4>Cover letter</h4>
            <p className="prose-text">{v.coverLetter || "No cover letter"}</p>
            <h4>Short answers</h4>
            <p className="prose-text">{v.shortAnswers || "No answers"}</p>
            <h4>Reviewer notes</h4>
            <p className="prose-text">{v.reviewerNotes || "No notes"}</p>
          </details>
        ))
      )}
    </section>
  );
}
function SavedForm({ initial }: { initial: Saved }) {
  async function recover() {
    try {
      const latest = await api<Saved>("/api/saved-jobs/" + saved.id);
      if (notes === (saved.notes ?? "")) setNotes(latest.notes ?? "");
      if (priority === (saved.priority ?? ""))
        setPriority(latest.priority ?? "");
      if (status === (saved.status ?? "")) setStatus(latest.status ?? "");
      if (outcome === (saved.outcomeNotes ?? ""))
        setOutcome(latest.outcomeNotes ?? "");
      if (url === (saved.submissionUrl ?? ""))
        setUrl(latest.submissionUrl ?? "");
      setSaved(latest);
      setError(undefined);
      setMessage(
        "Latest saved details loaded. Your changed fields are retained; review before saving.",
      );
    } catch (e) {
      setError(e);
    }
  }
  const [saved, setSaved] = useState(initial),
    [notes, setNotes] = useState(initial.notes ?? ""),
    [priority, setPriority] = useState(initial.priority ?? ""),
    [status, setStatus] = useState(initial.status),
    [outcome, setOutcome] = useState(initial.outcomeNotes ?? ""),
    [url, setUrl] = useState(initial.submissionUrl ?? ""),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    setMessage("");
    try {
      const next = await api<Saved>("/api/saved-jobs/" + saved.id, "PATCH", {
        expectedRevision: saved.revision,
        notes,
        priority: priority || null,
        ...(status ? { status } : {}),
        outcomeNotes: outcome,
        submissionUrl: url || null,
      });
      setSaved(next);
      setMessage("Saved job updated.");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>Saved job details</h2>
      <button type="button" onClick={() => void recover()}>
        Refresh details, keep my edits
      </button>
      <p className="muted">Revision {saved.revision}</p>
      <ErrorMessage error={error} />
      {!!error && (
        <a
          href={location.pathname + location.search}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open latest saved job in a new tab
        </a>
      )}
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      <form onSubmit={(e) => void save(e)}>
        <div className="form-grid">
          <StatusSelect
            from={saved.status}
            value={status}
            onChange={setStatus}
          />
          <label className="field">
            <span>Priority</span>
            <select
              aria-label="Priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              <option value="">Not set</option>
              {["Low", "Medium", "High"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
        </div>
        <TextArea label="Notes" value={notes} onChange={setNotes} />
        <TextArea label="Outcome notes" value={outcome} onChange={setOutcome} />
        <Field
          label="Submission URL"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          maxLength={4096}
        />
        <p className="small muted">
          Record a submission only after you have submitted it on the source
          site.
        </p>
        <button className="primary" disabled={busy}>
          {busy ? "Saving…" : "Save job details"}
        </button>
      </form>
    </section>
  );
}
export function SavedDetails({ id }: { id: string }) {
  const result = useResource<Saved>(
      "/api/saved-jobs/" + encodeURIComponent(id),
    ),
    drafts = useResource<{
      items: { id: string; revision: number; status: string | null }[];
    }>("/api/saved-jobs/" + encodeURIComponent(id) + "/drafts"),
    [chosen, setChosen] = useState("");
  if (result.loading) return <Loading />;
  if (result.error)
    return <LoadError error={result.error} retry={result.reload} />;
  const saved = result.data!,
    draftId = chosen || drafts.data?.items[0]?.id;
  return (
    <>
      <a className="back" href="/">
        ← Dashboard
      </a>
      <PageHeading
        title={saved.job.title}
        description={saved.job.company ?? undefined}
      >
        <a className="button" href={"/jobs/" + saved.jobId}>
          View job listing
        </a>
      </PageHeading>
      <div className="two-columns align-start">
        <SavedForm key={saved.id} initial={saved} />
        <div className="stack">
          <GenerationPanel
            savedJobId={saved.id}
            draftId={draftId}
            onCreated={(id) => {
              setChosen(id);
              drafts.reload();
            }}
          />
          {drafts.loading ? (
            <Loading />
          ) : drafts.error ? (
            <LoadError error={drafts.error} retry={drafts.reload} />
          ) : !draftId ? (
            <section className="panel">
              <p>No draft is attached to this saved job.</p>
            </section>
          ) : (
            <>
              <label className="field">
                <span>Draft to review</span>
                <select
                  aria-label="Draft to review"
                  value={draftId}
                  onChange={(e) => setChosen(e.target.value)}
                >
                  {drafts.data?.items.map((d, i) => (
                    <option key={d.id} value={d.id}>
                      {i === 0 ? "Latest draft" : "Earlier draft"} ·{" "}
                      {d.status ?? "Unknown"} · revision {d.revision}
                    </option>
                  ))}
                </select>
              </label>
              <DraftEditor key={draftId} id={draftId} />
            </>
          )}
        </div>
      </div>
    </>
  );
}
