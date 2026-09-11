import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { api, ApiError, useResource, type Session } from "./api";
import { Layout, LoadError, Loading } from "./components";
import { AuthPage, Account } from "./routes/auth";
import { Jobs, JobDetails } from "./routes/jobs";
import { Profiles } from "./routes/profiles";
import { Dashboard } from "./routes/dashboard";
import { SavedDetails } from "./routes/saved";
import { Consent } from "./routes/consent";
import "./style.css";
const path = location.pathname,
  publicRoute = [
    "/login",
    "/sign-up",
    "/forgot-password",
    "/reset-password",
    "/link-expired",
  ].includes(path);
function App() {
  const session = useResource<Session>("/api/session");
  const [validation, setValidation] = useState<"idle" | "checking" | "failed">(
    "idle",
  );
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const hide = () => {
      document.getElementById("root")!.hidden = true;
    };
    const restore = (e: PageTransitionEvent) => {
      if (e.persisted) location.reload();
    };
    let checking = false;
    let live = true;
    async function check() {
      if (checking || document.visibilityState === "hidden") return;
      checking = true;
      setValidation("checking");
      try {
        await api("/api/session");
        if (live) setValidation("idle");
      } catch (error) {
        // api() removes private content only for confirmed HTTP 401. A failed
        // connection or gateway response leaves the mounted editors intact.
        if (live && !(error instanceof ApiError && error.status === 401))
          setValidation("failed");
      } finally {
        checking = false;
      }
    }
    const focus = () => void check(),
      timer = setInterval(focus, 30000);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", restore);
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    if (retry > 0) void check();
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", restore);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [retry]);
  if (session.loading)
    return (
      <main className="container">
        <Loading />
      </main>
    );
  if (session.error)
    return (
      <main className="container">
        <LoadError error={session.error} retry={session.reload} />
      </main>
    );
  const id =
    path === "/job-details" || path === "/saved-job-details"
      ? (new URLSearchParams(location.search).get("recordId") ?? "")
      : decodeURIComponent(path.split("/")[2] ?? "");
  let content;
  if (path === "/") content = <Dashboard />;
  else if (path === "/jobs") content = <Jobs />;
  else if (path === "/job-details" || path.startsWith("/jobs/"))
    content = <JobDetails id={id} />;
  else if (path === "/saved-job-details" || path.startsWith("/saved-jobs/"))
    content = <SavedDetails id={id} />;
  else if (path === "/profile" || path === "/onboarding")
    content = <Profiles onboarding={path === "/onboarding"} />;
  else if (path === "/account") content = <Account session={session.data!} />;
  else if (path === "/consent") content = <Consent />;
  else content = <h1>Page not found</h1>;
  return (
    <Layout session={session.data!}>
      <div aria-live="polite">
        {validation === "checking" && (
          <p role="status" className="notice">
            Checking your session… Your unsaved edits are retained.
          </p>
        )}
        {validation === "failed" && (
          <div className="notice">
            <p role="alert">
              We could not verify your session. Your unsaved edits are retained.
              Retry when your connection is available.
            </p>
            <button onClick={() => setRetry((value) => value + 1)}>
              Retry session check
            </button>
          </div>
        )}
      </div>
      {content}
    </Layout>
  );
}
createRoot(document.getElementById("root")!).render(
  publicRoute ? <AuthPage /> : <App />,
);
