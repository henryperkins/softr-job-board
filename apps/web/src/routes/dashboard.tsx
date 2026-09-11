import { useState } from "react";
import { api, useResource, type Saved } from "../api";
import {
  ErrorMessage,
  LoadError,
  Loading,
  PageHeading,
  StatusSelect,
} from "../components";
type DashboardData = {
  savedJobs: Saved[];
  nextCursor: string | null;
  counts: {
    savedJobs: number;
    profiles: number;
    byStatus: { status: string | null; count: number }[];
  };
};
function SavedCard({
  saved,
  onChange,
}: {
  saved: Saved;
  onChange: () => void;
}) {
  const [status, setStatus] = useState(saved.status),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  async function update() {
    setBusy(true);
    setError(undefined);
    try {
      await api("/api/saved-jobs/" + saved.id, "PATCH", {
        expectedRevision: saved.revision,
        status,
      });
      onChange();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="saved-card">
      <h3>
        <a href={"/saved-jobs/" + saved.id}>{saved.job.title}</a>
      </h3>
      <p className="muted">{saved.job.company ?? "Company not provided"}</p>
      {saved.priority && <span className="tag">{saved.priority} priority</span>}
      {saved.draft && (
        <p className="small">
          Latest draft: {saved.draft.status ?? "Unknown"} ·{" "}
          {saved.draft.executionStatus}
        </p>
      )}
      <StatusSelect
        from={saved.status}
        label={"Status for " + saved.job.title}
        value={status}
        onChange={setStatus}
      />
      <button
        disabled={busy || status === saved.status}
        onClick={() => void update()}
      >
        Update status
      </button>
      <ErrorMessage error={error} />
    </article>
  );
}
export function Dashboard() {
  const [query, setQuery] = useState("limit=24"),
    [pages, setPages] = useState<string[]>([]),
    result = useResource<DashboardData>("/api/dashboard?" + query);
  const activity = useResource<{
    items: {
      id: string;
      action: string;
      entityType: string;
      revision: number | null;
      createdAt: string;
    }[];
  }>("/api/activity?limit=8");
  if (result.loading) return <Loading />;
  if (result.error)
    return <LoadError error={result.error} retry={result.reload} />;
  const data = result.data!;
  const statuses = Array.from(
    new Set([
      ...data.counts.byStatus.map((s) => s.status),
      ...data.savedJobs.map((s) => s.status),
    ]),
  );
  return (
    <>
      <PageHeading
        title="Your job search"
        description="Track saved roles and review your next steps."
      >
        <a className="button primary" href="/jobs">
          Browse open roles
        </a>
      </PageHeading>
      <div className="stats">
        <div>
          <span>Saved jobs</span>
          <strong>{data.counts.savedJobs}</strong>
        </div>
        <div>
          <span>Profiles</span>
          <strong>{data.counts.profiles}</strong>
        </div>
        {data.counts.byStatus.map((s) => (
          <div key={s.status ?? "unknown"}>
            <span>{s.status ?? "Unknown status"}</span>
            <strong>{s.count}</strong>
          </div>
        ))}
      </div>
      <h2>Saved jobs</h2>
      <p className="small muted">
        Showing {data.savedJobs.length} of {data.counts.savedJobs} saved jobs ·
        Page {pages.length + 1}. Status counts cover all your saved jobs.
      </p>
      {!data.savedJobs.length ? (
        <section className="panel empty">
          <h3>Your saved jobs will appear here.</h3>
          <p>Browse roles and save the opportunities you want to track.</p>
        </section>
      ) : (
        <div className="board">
          {statuses.map((status) => (
            <section key={status ?? "unknown"} className="board-column">
              <h3>
                {status ?? "Unknown status"}{" "}
                <span className="count">
                  {data.counts.byStatus.find((s) => s.status === status)
                    ?.count ?? 0}
                </span>
              </h3>
              {data.savedJobs
                .filter((s) => s.status === status)
                .map((s) => (
                  <SavedCard
                    key={s.id + ":" + s.revision}
                    saved={s}
                    onChange={result.reload}
                  />
                ))}
              {!data.savedJobs.some((s) => s.status === status) && (
                <p className="small muted">No entries on this page.</p>
              )}
            </section>
          ))}
        </div>
      )}
      <div className="pagination">
        <button
          disabled={!pages.length}
          onClick={() => {
            setQuery(pages.at(-1)!);
            setPages((p) => p.slice(0, -1));
          }}
        >
          Previous saved page
        </button>
        <button
          disabled={!data.nextCursor}
          onClick={() => {
            setPages((p) => [...p, query]);
            setQuery("limit=24&cursor=" + encodeURIComponent(data.nextCursor!));
          }}
        >
          Next saved page
        </button>
      </div>
      <section className="panel activity">
        <h2>Recent activity</h2>
        {activity.loading ? (
          <Loading />
        ) : activity.error ? (
          <LoadError error={activity.error} retry={activity.reload} />
        ) : !activity.data?.items.length ? (
          <p className="muted">No recorded activity yet.</p>
        ) : (
          <ul>
            {activity.data.items.map((a) => (
              <li key={a.id}>
                <span>
                  {a.entityType.replaceAll("_", " ")} · {a.action}
                  {a.revision ? " · revision " + a.revision : ""}
                </span>
                <time dateTime={a.createdAt}>
                  {new Date(a.createdAt).toLocaleString()}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
