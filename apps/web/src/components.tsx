import { useState, type ReactNode, type InputHTMLAttributes } from "react";
import { api, friendly, type Session } from "./api";
import {
  canTransition,
  savedLabels,
  type SavedLabel,
} from "../../../packages/domain/src/contracts";
export function ErrorMessage({ error }: { error: unknown }) {
  return error ? (
    <p className="notice error" role="alert">
      {friendly(error)}
    </p>
  ) : null;
}
export function Loading() {
  return (
    <p role="status" className="muted">
      Loading…
    </p>
  );
}
export function LoadError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  return (
    <div>
      <ErrorMessage error={error} />
      <button onClick={retry}>Retry</button>
    </div>
  );
}
export function Field({
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input aria-label={label} {...props} />
    </label>
  );
}
export function TextArea({
  label,
  value,
  onChange,
  maxLength = 20000,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <textarea
        aria-label={label}
        rows={5}
        value={value}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
export function StatusSelect({
  value,
  onChange,
  label = "Status",
  from,
}: {
  value: string | null;
  onChange: (v: string) => void;
  label?: string;
  from?: string | null;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select
        aria-label={label}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
      >
        {!value && <option value="">Unknown</option>}
        {savedLabels
          .filter((v) =>
            canTransition(
              (from === undefined ? value : from) as SavedLabel | null,
              v,
            ),
          )
          .map((v) => (
            <option key={v}>{v}</option>
          ))}
      </select>
    </label>
  );
}
export function Layout({
  session,
  children,
}: {
  session: Session;
  children: ReactNode;
}) {
  const [error, setError] = useState<unknown>();
  async function logout() {
    try {
      await api("/auth/sign-out", "POST", {});
      document.getElementById("root")?.replaceChildren();
      location.replace("/login");
    } catch (e) {
      setError(e);
    }
  }
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="header-inner">
          <a className="brand" href="/">
            AI Jobs
          </a>
          <nav aria-label="Main navigation">
            {[
              ["/", "Dashboard"],
              ["/jobs", "Jobs"],
              ["/profile", "My profiles"],
              ["/account", "Account"],
            ].map(([href, label]) => (
              <a
                key={href}
                aria-current={location.pathname === href ? "page" : undefined}
                href={href}
              >
                {label}
              </a>
            ))}
          </nav>
          <button className="quiet" onClick={() => void logout()}>
            Log out
          </button>
        </div>
      </header>
      <main id="main" className="container">
        <ErrorMessage error={error} />
        {!session.flags.writesEnabled && (
          <p className="notice">Changes are currently unavailable.</p>
        )}
        {children}
      </main>
      <footer>AI Jobs · Your job search, in one place</footer>
    </>
  );
}
export function PageHeading({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        {description && <p className="muted">{description}</p>}
      </div>
      {children}
    </div>
  );
}
