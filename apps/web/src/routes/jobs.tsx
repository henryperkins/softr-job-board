import { useState, type FormEvent } from "react";
import { api, useResource, type Job, type Page, type Saved } from "../api";
import {
  ErrorMessage,
  Field,
  LoadError,
  Loading,
  PageHeading,
} from "../components";
export function Jobs() {
  const [filters, setFilters] = useState({
      q: "",
      remote: "",
      employment: "",
      seniority: "",
    }),
    [query, setQuery] = useState("limit=12&status=Open"),
    [pages, setPages] = useState<string[]>([]);
  const options =
      useResource<Record<"remote" | "employment" | "seniority", string[]>>(
        "/api/job-options",
      ),
    result = useResource<Page<Job>>("/api/jobs?" + query);
  function search(e: FormEvent) {
    e.preventDefault();
    setPages([]);
    const p = new URLSearchParams({ limit: "12", status: "Open" });
    for (const [k, v] of Object.entries(filters))
      if (v.trim()) p.set(k, v.trim());
    setQuery(p.toString());
  }
  function next() {
    if (!result.data?.nextCursor) return;
    setPages((p) => [...p, query]);
    const q = new URLSearchParams(query);
    q.set("cursor", result.data.nextCursor);
    setQuery(q.toString());
  }
  return (
    <>
      <PageHeading
        title="Open roles"
        description="Find your next opportunity."
      />
      <form className="panel filters" onSubmit={search}>
        <Field
          label="Search title or company"
          placeholder="Search jobs…"
          value={filters.q}
          onChange={(e) => setFilters({ ...filters, q: e.target.value })}
          maxLength={200}
        />
        {(["remote", "employment", "seniority"] as const).map((k) => (
          <label key={k} className="field">
            <span>
              {k === "remote"
                ? "Workplace"
                : k === "employment"
                  ? "Employment type"
                  : "Seniority"}
            </span>
            <select
              aria-label={
                k === "remote"
                  ? "Workplace"
                  : k === "employment"
                    ? "Employment type"
                    : "Seniority"
              }
              value={filters[k]}
              onChange={(e) => setFilters({ ...filters, [k]: e.target.value })}
            >
              <option value="">
                All{" "}
                {k === "remote"
                  ? "workplaces"
                  : k === "employment"
                    ? "types"
                    : "levels"}
              </option>
              {options.data?.[k].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
        ))}
        <button className="primary" type="submit">
          Search
        </button>
        <button
          type="button"
          onClick={() => {
            setFilters({ q: "", remote: "", employment: "", seniority: "" });
            setPages([]);
            setQuery("limit=12&status=Open");
          }}
        >
          Clear
        </button>
      </form>
      {!!options.error && (
        <LoadError error={options.error} retry={options.reload} />
      )}
      <div aria-live="polite" aria-busy={result.loading}>
        {result.loading ? (
          <Loading />
        ) : result.error ? (
          <LoadError error={result.error} retry={result.reload} />
        ) : !result.data?.items.length ? (
          <section className="panel empty">
            <h2>No jobs match those filters yet.</h2>
            <p>Try another title, company, or filter.</p>
          </section>
        ) : (
          <>
            <p className="result-count muted">
              Page {pages.length + 1} · {result.data.items.length} roles on this
              page
            </p>
            <div className="job-list">
              {result.data.items.map((j) => (
                <article className="job-card" key={j.id} data-job-id={j.id}>
                  <div>
                    <h2>
                      <a
                        href={
                          "/job-details?recordId=" +
                          encodeURIComponent(j.legacyId ?? j.id)
                        }
                      >
                        {j.title}
                      </a>
                    </h2>
                    <p className="company">
                      {j.company ?? "Company not provided"}
                      {j.location && <span> · {j.location}</span>}
                    </p>
                    <div className="tags">
                      {[j.remote, j.employment, j.seniority]
                        .filter(Boolean)
                        .map((v, i) => (
                          <span className="tag" key={i}>
                            {v}
                          </span>
                        ))}
                      {j.status && j.status !== "Open" && (
                        <span className="tag">{j.status}</span>
                      )}
                    </div>
                  </div>
                  <a
                    className="button"
                    href={
                      "/job-details?recordId=" +
                      encodeURIComponent(j.legacyId ?? j.id)
                    }
                    aria-label={"View " + j.title}
                  >
                    View job <span aria-hidden="true">→</span>
                  </a>
                </article>
              ))}
            </div>
            <div className="pagination">
              <button
                disabled={!pages.length}
                onClick={() => {
                  setQuery(pages.at(-1)!);
                  setPages((p) => p.slice(0, -1));
                }}
              >
                Previous page
              </button>
              <span>Page {pages.length + 1}</span>
              <button disabled={!result.data.nextCursor} onClick={next}>
                Next page
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
export function JobDetails({ id }: { id: string }) {
  const result = useResource<Job>("/api/jobs/" + encodeURIComponent(id));
  const state = useResource<{ savedJobId: string | null }>(
    "/api/jobs/" + encodeURIComponent(id) + "/save-state",
  );
  const [saved, setSaved] = useState<string>(),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      const s = await api<Saved>("/api/saved-jobs", "POST", {
        jobId: result.data!.id,
      });
      setSaved(s.id);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  if (result.loading) return <Loading />;
  if (result.error)
    return <LoadError error={result.error} retry={result.reload} />;
  const j = result.data!;
  const savedId = saved ?? state.data?.savedJobId;
  return (
    <>
      <a className="back" href="/jobs">
        ← All jobs
      </a>
      <PageHeading
        title={j.title}
        description={[j.company, j.location].filter(Boolean).join(" · ")}
      />
      <div className="detail-layout">
        <article className="panel">
          <div className="tags">
            {[j.remote, j.employment, j.seniority, j.status]
              .filter(Boolean)
              .map((v, i) => (
                <span className="tag" key={i}>
                  {v}
                </span>
              ))}
          </div>
          <h2>About this role</h2>
          <div className="prose-text">
            {j.description || "No description was provided by the source."}
          </div>
        </article>
        <aside className="panel">
          <h2>Your next step</h2>
          <ErrorMessage error={error} />
          {savedId ? (
            <>
              <p className="notice" role="status">
                Saved to your job search.
              </p>
              <a
                className="button primary full"
                href={"/saved-jobs/" + encodeURIComponent(savedId)}
              >
                Open saved job
              </a>
            </>
          ) : (
            <button
              className="primary full"
              disabled={busy || state.loading}
              onClick={() => void save()}
            >
              {busy ? "Saving…" : "Save job"}
            </button>
          )}
          {!!state.error && (
            <LoadError error={state.error} retry={state.reload} />
          )}
          <hr />
          {j.sourceUrl ? (
            <a
              className="external-link"
              href={j.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              View application on source site ↗
            </a>
          ) : (
            <p className="muted">No source application link is available.</p>
          )}
          <p className="small muted">
            Opening the source site does not submit an application or change
            your status.
          </p>
        </aside>
      </div>
    </>
  );
}
