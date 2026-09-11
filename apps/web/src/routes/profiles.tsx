import { useState, type FormEvent } from "react";
import {
  api,
  useResource,
  type Profile,
  type Profiles as ProfilesData,
} from "../api";
import {
  ErrorMessage,
  Field,
  TextArea,
  LoadError,
  Loading,
  PageHeading,
} from "../components";
type Attachment = {
  id: string;
  filename: string;
  mediaType: string;
  sizeBytes: number;
  status: string;
  scanStatus: string;
};
const fields = [
  ["headline", "Headline"],
  ["email", "Contact email"],
  ["location", "Location"],
  ["skills", "Skills (one per line)"],
  ["targetRoles", "Target roles (one per line)"],
  ["summary", "Summary"],
  ["experience", "Experience"],
  ["education", "Education"],
  ["preferences", "Preferences"],
  ["yearsOfExperience", "Years of experience"],
  ["portfolioUrl", "Portfolio URL"],
  ["linkedinUrl", "LinkedIn URL"],
  ["githubUrl", "GitHub URL"],
  ["preferredWorkType", "Preferred workplace"],
  ["preferredEmploymentType", "Preferred employment type"],
  ["salaryMinimum", "Minimum salary"],
] as const;
const longFields = new Set([
  "summary",
  "skills",
  "targetRoles",
  "experience",
  "education",
  "preferences",
]);
function textValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  if (Array.isArray(value))
    return value
      .filter((v: unknown) => typeof v === "string" || typeof v === "number")
      .join("\n");
  return "";
}
function formValues(p?: Profile) {
  return Object.fromEntries(
    fields.map(([key]) => [key, textValue(p?.content[key])]),
  );
}
function ProfileEditor({
  profile,
  onSaved,
  onCancel,
}: {
  profile?: Profile;
  onSaved: (p: Profile) => void;
  onCancel: () => void;
}) {
  const [requestKey] = useState(() => crypto.randomUUID());
  const [name, setName] = useState(profile?.name ?? ""),
    [values, setValues] = useState(() => formValues(profile)),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const content: Record<string, unknown> = {};
    for (const [key] of fields) {
      const value = values[key];
      content[key] = ["skills", "targetRoles"].includes(key)
        ? value
            .split("\n")
            .map((v) => v.trim())
            .filter(Boolean)
        : ["yearsOfExperience", "salaryMinimum"].includes(key)
          ? value === ""
            ? null
            : Number(value)
          : [
                "email",
                "location",
                "portfolioUrl",
                "linkedinUrl",
                "githubUrl",
                "preferredWorkType",
                "preferredEmploymentType",
              ].includes(key)
            ? value.trim() || null
            : value;
    }
    try {
      const p = await api<Profile>(
        profile ? "/api/profiles/" + profile.id : "/api/profiles",
        profile ? "PATCH" : "POST",
        {
          name,
          content,
          ...(profile
            ? { expectedRevision: profile.revision }
            : { idempotencyKey: requestKey }),
        },
      );
      onSaved(p);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>{profile ? "Edit profile" : "Create a profile"}</h2>
      <p className="muted">
        Only enter details you want to save. Unknown values may stay blank.
      </p>
      <ErrorMessage error={error} />
      {!!error && profile && (
        <a
          href={"/profile?selected=" + encodeURIComponent(profile.id)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open latest profile in a new tab
        </a>
      )}
      <form onSubmit={(e) => void save(e)}>
        <Field
          label="Full name / profile name"
          value={name}
          required
          maxLength={200}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="form-grid">
          {fields.map(([key, label]) =>
            longFields.has(key) ? (
              <div className="wide" key={key}>
                <TextArea
                  label={label}
                  value={values[key]}
                  onChange={(v) => setValues({ ...values, [key]: v })}
                  maxLength={
                    key === "experience"
                      ? 50000
                      : key === "preferences"
                        ? 10000
                        : 20000
                  }
                />
              </div>
            ) : (
              <Field
                key={key}
                label={label}
                value={values[key]}
                type={
                  key === "email"
                    ? "email"
                    : key.endsWith("Url")
                      ? "url"
                      : ["yearsOfExperience", "salaryMinimum"].includes(key)
                        ? "number"
                        : "text"
                }
                min={0}
                max={
                  key === "yearsOfExperience"
                    ? 100
                    : key === "salaryMinimum"
                      ? 1000000000
                      : undefined
                }
                step="any"
                maxLength={
                  key === "headline"
                    ? 300
                    : key === "location"
                      ? 500
                      : key.endsWith("Url")
                        ? 4096
                        : 320
                }
                onChange={(e) =>
                  setValues({ ...values, [key]: e.target.value })
                }
              />
            ),
          )}
        </div>
        <div className="actions">
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : "Save profile"}
          </button>
          <button type="button" disabled={busy} onClick={onCancel}>
            Cancel edits
          </button>
        </div>
      </form>
    </section>
  );
}
function Files({
  profile,
  onUploaded,
}: {
  profile: Profile;
  onUploaded: (p: Profile) => void;
}) {
  const result = useResource<{ items: Attachment[] }>(
      "/api/profiles/" + profile.id + "/attachments",
    ),
    [file, setFile] = useState<File>(),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function upload(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(undefined);
    setMessage("");
    const form = new FormData();
    form.set("file", file);
    form.set("expectedRevision", String(profile.revision));
    try {
      const data = await api<{ profile: Profile }>(
        "/api/profiles/" + profile.id + "/attachments",
        "POST",
        form,
      );
      setMessage(
        "File stored privately and pending a security scan. Download is unavailable until it is cleared.",
      );
      onUploaded(data.profile);
      result.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>Private files</h2>
      <p className="muted">
        PDF, JPEG, PNG, or WebP · up to 8 MiB per file. Files are quarantined
        until a security scan is available.
      </p>
      <ErrorMessage error={error} />
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      {!profile.archived && (
        <form onSubmit={(e) => void upload(e)}>
          <Field
            label="Choose a profile file"
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            onChange={(e) => setFile(e.target.files?.[0])}
            required
          />
          <button disabled={busy || !file}>
            {busy ? "Uploading…" : "Upload private file"}
          </button>
        </form>
      )}
      {result.loading ? (
        <Loading />
      ) : result.error ? (
        <LoadError error={result.error} retry={result.reload} />
      ) : !result.data?.items.length ? (
        <p className="muted">No files attached to this profile.</p>
      ) : (
        <ul className="file-list">
          {result.data.items.map((f) => (
            <li key={f.id}>
              <strong>{f.filename ?? "Unnamed file"}</strong>
              <span>
                {f.sizeBytes !== null
                  ? `${Math.ceil(f.sizeBytes / 1024)} KiB · `
                  : ""}
                {f.status === "available" && f.scanStatus === "clean" ? (
                  <a href={"/api/attachments/" + f.id + "/download"}>
                    Download file
                  </a>
                ) : f.scanStatus === "rejected" || f.status === "rejected" ? (
                  "Rejected — download unavailable"
                ) : f.status === "missing" ? (
                  "Missing file — download unavailable"
                ) : (
                  "Pending security scan — download unavailable"
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
export function Profiles({ onboarding = false }: { onboarding?: boolean }) {
  const result = useResource<ProfilesData>("/api/profiles"),
    [selected, setSelected] = useState(
      new URLSearchParams(location.search).get("selected") ?? "",
    ),
    [editing, setEditing] = useState(false),
    [creating, setCreating] = useState(false),
    [committed, setCommitted] = useState<Profile>(),
    [error, setError] = useState<unknown>(),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const p =
    committed?.id === selected
      ? committed
      : result.data?.items.find((x) => x.id === selected);
  async function action(kind: "activate" | "archive", archived?: boolean) {
    if (!p) return;
    setBusy(true);
    setError(undefined);
    try {
      const response = await api<Profile>(
        "/api/profiles/" + p.id + "/" + kind,
        "POST",
        kind === "activate" ? {} : { expectedRevision: p.revision, archived },
      );
      if (kind === "archive") setCommitted(response);
      setMessage(
        kind === "activate"
          ? "Active profile chosen."
          : archived
            ? "Profile archived. Previous versions are preserved."
            : "Profile restored.",
      );
      result.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  function saved(next: Profile) {
    setCommitted(next);
    setSelected(next.id);
    setCreating(false);
    setEditing(false);
    setMessage("Profile saved. Choose it as your active profile when ready.");
    result.reload();
  }
  if (result.loading && !result.data) return <Loading />;
  if (result.error && !result.data)
    return <LoadError error={result.error} retry={result.reload} />;
  return (
    <>
      <PageHeading
        title={onboarding ? "Set up your profile" : "My profiles"}
        description={
          onboarding
            ? "Save a profile, then explicitly choose it for your job search. You can return here at any time."
            : "Keep different profiles for different opportunities."
        }
      >
        <button
          className="primary"
          disabled={editing || creating}
          onClick={() => {
            setCreating(true);
            setSelected("");
            setCommitted(undefined);
          }}
        >
          Create profile
        </button>
      </PageHeading>
      <ErrorMessage error={error || result.error} />
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      <p className="muted">
        {result.data?.activeProfileId
          ? "Active profile: " +
            result.data.items.find((x) => x.id === result.data!.activeProfileId)
              ?.name
          : "No active profile chosen."}
      </p>
      <div className="profile-layout">
        <aside className="panel">
          <h2>Your profiles</h2>
          {!result.data?.items.length ? (
            <p className="muted">No profiles yet. Create one to get started.</p>
          ) : (
            <ul className="profile-list">
              {result.data.items.map((profile) => (
                <li key={profile.id}>
                  <button
                    disabled={editing || creating}
                    className={selected === profile.id ? "selected" : ""}
                    onClick={() => {
                      setSelected(profile.id);
                      setCommitted(undefined);
                      setMessage("");
                      setError(undefined);
                    }}
                  >
                    {profile.name}
                    <span>
                      {profile.archived
                        ? "Archived"
                        : profile.id === result.data!.activeProfileId
                          ? "Active"
                          : "Not active"}{" "}
                      · Revision {profile.revision}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {onboarding && result.data?.activeProfileId && (
            <a className="button primary full" href="/">
              Continue to dashboard
            </a>
          )}
        </aside>
        <div className="stack">
          {creating || editing ? (
            <ProfileEditor
              key={creating ? "new" : p?.id}
              profile={creating ? undefined : p}
              onSaved={saved}
              onCancel={() => {
                setCreating(false);
                setEditing(false);
              }}
            />
          ) : p ? (
            <>
              <section className="panel">
                <div className="section-heading">
                  <div>
                    <h2>{p.name}</h2>
                    <p className="muted">
                      Revision {p.revision}
                      {p.archived ? " · Archived" : ""}
                    </p>
                  </div>
                </div>
                <div className="actions">
                  {!p.archived && (
                    <>
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() => setEditing(true)}
                      >
                        Edit profile
                      </button>
                      <button
                        disabled={busy || result.data?.activeProfileId === p.id}
                        onClick={() => void action("activate")}
                      >
                        Choose as active
                      </button>
                    </>
                  )}
                  <button
                    disabled={busy}
                    onClick={() => void action("archive", !p.archived)}
                  >
                    {p.archived ? "Restore profile" : "Archive profile"}
                  </button>
                </div>
                <dl className="profile-details">
                  {fields.map(([key, label]) => {
                    const value = p.content[key];
                    return value !== null &&
                      value !== undefined &&
                      value !== "" &&
                      (!Array.isArray(value) || value.length) ? (
                      <div key={key}>
                        <dt>{label}</dt>
                        <dd className="prose-text">{textValue(value)}</dd>
                      </div>
                    ) : null;
                  })}
                </dl>
              </section>
              <Files
                key={p.id}
                profile={p}
                onUploaded={(next) => {
                  setCommitted(next);
                  result.reload();
                }}
              />
            </>
          ) : (
            <section className="panel empty">
              <h2>Choose a profile</h2>
              <p>Select one to view its details, or create a new profile.</p>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
