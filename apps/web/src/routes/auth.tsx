import { useState, type FormEvent } from "react";
import { api, ApiError, safeNext, type Session } from "../api";
import { ErrorMessage, Field, PageHeading } from "../components";
import { ConnectedApps } from "./consent";
const receipt =
  "Request received. If eligible, your email will contain the next steps. You may retry if it does not arrive.";
export function AuthPage() {
  const path = location.pathname,
    params = new URLSearchParams(location.search);
  // The OAuth provider signed this complete query. Keep it byte-for-byte across
  // login/signup/verification; rebuilding selected parameters would discard the
  // signature or silently change the request the user is authorizing.
  const oauthQuery =
    params.has("sig") && params.has("client_id")
      ? location.search.slice(1)
      : undefined;
  const authSwitchQuery = oauthQuery ? location.search : "";
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState(""),
    [error, setError] = useState<unknown>(),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const expired =
    path === "/link-expired" ||
    (path === "/reset-password" &&
      (!params.get("token") || params.has("error"))) ||
    (path === "/login" && params.has("error"));
  const title = expired
    ? "This link is unavailable"
    : path === "/sign-up"
      ? "Create your account"
      : path === "/forgot-password"
        ? "Reset your password"
        : path === "/reset-password"
          ? "Choose a new password"
          : "Welcome back";
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    setMessage("");
    try {
      if (path === "/login") {
        const result = await api<{ redirect?: boolean; url?: string }>(
          "/auth/sign-in/email",
          "POST",
          {
            email,
            password,
            ...(oauthQuery ? { oauth_query: oauthQuery } : {}),
          },
        );
        if (oauthQuery) {
          if (!result.redirect || !result.url)
            throw new ApiError(502, "oauth_continuation_unavailable");
          const target = new URL(result.url, location.origin);
          if (!["http:", "https:"].includes(target.protocol))
            throw new ApiError(502, "oauth_continuation_unavailable");
          location.replace(target.toString());
        } else location.replace(safeNext(params.get("next-page")));
      } else if (path === "/sign-up") {
        await api("/auth/sign-up/email", "POST", {
          email,
          password,
          name,
          callbackURL: location.origin + "/login" + authSwitchQuery,
          ...(oauthQuery ? { oauth_query: oauthQuery } : {}),
        });
        setPassword("");
        setMessage(receipt);
      } else if (path === "/forgot-password") {
        await api("/auth/request-password-reset", "POST", {
          email,
          redirectTo: location.origin + "/reset-password",
        });
        setMessage(receipt);
      } else {
        await api("/auth/reset-password", "POST", {
          newPassword: password,
          token: params.get("token"),
        });
        setPassword("");
        setMessage("Password changed. You can sign in with your new password.");
      }
    } catch (e) {
      if (
        path === "/reset-password" &&
        e instanceof ApiError &&
        [
          "INVALID_TOKEN",
          "TOKEN_EXPIRED",
          "RESET_PASSWORD_TOKEN_EXPIRED",
        ].includes(e.code)
      )
        location.replace("/link-expired");
      else setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function resend() {
    setBusy(true);
    setError(undefined);
    try {
      await api("/auth/send-verification-email", "POST", {
        email,
        callbackURL: location.origin + "/login" + authSwitchQuery,
        ...(oauthQuery ? { oauth_query: oauthQuery } : {}),
      });
      setMessage(receipt);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <a className="brand" href="/login">
        AI Jobs
      </a>
      <section className="auth-card">
        <h1>{title}</h1>
        <p className="muted">
          {expired
            ? "This link may have expired or already been used. Request a new link to continue."
            : path === "/login"
              ? "Sign in to continue your job search."
              : path === "/sign-up"
                ? "Use your email and a password of at least 12 characters."
                : "Enter your details to continue."}
        </p>
        <ErrorMessage error={error} />
        {message && (
          <p role="status" className="notice">
            {message}
          </p>
        )}
        {expired ? (
          <a href="/forgot-password">Request a new reset link</a>
        ) : (
          <form onSubmit={(e) => void submit(e)}>
            {path === "/sign-up" && (
              <Field
                label="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={200}
                autoComplete="name"
              />
            )}
            {path !== "/reset-password" && (
              <Field
                label="Email address"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            )}
            {path !== "/forgot-password" && (
              <Field
                label={path === "/reset-password" ? "New password" : "Password"}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={
                  path === "/login" ? "current-password" : "new-password"
                }
                minLength={path === "/login" ? 1 : 12}
                required
              />
            )}
            <button className="primary full" disabled={busy}>
              {busy
                ? "Please wait…"
                : path === "/login"
                  ? "Sign in"
                  : path === "/sign-up"
                    ? "Create account"
                    : path === "/forgot-password"
                      ? "Request reset link"
                      : "Change password"}
            </button>
          </form>
        )}
        {path === "/login" && (
          <>
            <a href="/forgot-password">Forgot password?</a>
            <button
              className="text-button"
              disabled={busy || !email}
              onClick={() => void resend()}
            >
              Resend verification email
            </button>
          </>
        )}
        <p className="auth-links">
          {path !== "/login" ? (
            <a href={`/login${authSwitchQuery}`}>Back to sign in</a>
          ) : (
            <>
              New to AI Jobs?{" "}
              <a href={`/sign-up${authSwitchQuery}`}>Create an account</a>
            </>
          )}
        </p>
      </section>
    </main>
  );
}
export function Account({ session }: { session: Session }) {
  const [current, setCurrent] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState(session.user.name),
    [error, setError] = useState<unknown>(),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function change(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    setMessage("");
    try {
      await api("/auth/change-password", "POST", {
        currentPassword: current,
        newPassword: password,
        revokeOtherSessions: true,
      });
      setCurrent("");
      setPassword("");
      setMessage("Password changed and your other sessions were revoked.");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function updateName(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    setMessage("");
    try {
      await api("/auth/update-user", "POST", { name });
      setMessage("Account name saved.");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        title="Account"
        description="Manage your sign-in and sessions."
      />
      <ErrorMessage error={error} />
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      <div className="two-columns">
        <section className="panel">
          <h2>Account details</h2>
          <p>{session.user.email}</p>
          <form onSubmit={(e) => void updateName(e)}>
            <Field
              label="Account name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={200}
            />
            <button disabled={busy}>Save account name</button>
          </form>
        </section>
        <section className="panel">
          <h2>Change password</h2>
          <p className="muted">Your other sessions will be signed out.</p>
          <form onSubmit={(e) => void change(e)}>
            <Field
              label="Current password"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
            />
            <Field
              label="New password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button className="primary" disabled={busy}>
              Change password
            </button>
          </form>
        </section>
      </div>
      <ConnectedApps />
    </>
  );
}
