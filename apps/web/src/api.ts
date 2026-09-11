import { useEffect, useState } from "react";
export type Session = {
  user: { id: string; email: string; name: string };
  flags: {
    writesEnabled: boolean;
    generationEnabled: boolean;
    mcpEnabled: boolean;
    mcpWritesEnabled: boolean;
    mcpGenerationEnabled: boolean;
    mcpReviewEnabled: boolean;
  };
};
export type Job = {
  id: string;
  legacyId: string | null;
  title: string;
  company: string | null;
  location: string | null;
  remote: string | null;
  employment: string | null;
  seniority: string | null;
  description: string | null;
  sourceUrl: string | null;
  status: string | null;
  createdAt: string;
};
export type Profile = {
  id: string;
  revision: number;
  name: string;
  content: Record<string, unknown>;
  archived: boolean;
  active?: boolean;
  updatedAt: string;
};
export type Profiles = {
  items: Profile[];
  activeProfileId: string | null;
  activeProfileVersionId: string | null;
};
export type Saved = {
  id: string;
  jobId: string;
  job: { title: string; company: string | null };
  revision: number;
  notes: string | null;
  priority: string | null;
  status: string | null;
  outcomeNotes: string | null;
  submissionUrl: string | null;
  draft: null | {
    id: string;
    status: string | null;
    executionStatus: string;
    revision: number;
  };
};
export type Draft = {
  id: string;
  savedJobId: string;
  revision: number;
  status: string | null;
  executionStatus: string;
  coverLetter: string | null;
  shortAnswers: string | null;
  reviewerNotes: string | null;
  approvedRevision: number | null;
  provenance: string;
  updatedAt: string;
};
export type Page<T> = { items: T[]; nextCursor: string | null };
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export function loginRedirect() {
  document.getElementById("root")?.replaceChildren();
  location.replace(
    "/login?next-page=" +
      encodeURIComponent(location.pathname + location.search),
  );
}
export async function api<T>(
  path: string,
  method = "GET",
  data?: unknown,
): Promise<T> {
  const multipart = data instanceof FormData;
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers:
      data !== undefined && !multipart
        ? { "Content-Type": "application/json" }
        : undefined,
    body:
      data === undefined ? undefined : multipart ? data : JSON.stringify(data),
  });
  // A confirmed unauthorized response invalidates private UI even if a proxy
  // returned an empty or non-JSON error body.
  if (response.status === 401 && path.startsWith("/api/")) {
    loginRedirect();
    throw new ApiError(401, "unauthenticated");
  }
  const result = (await response.json()) as T & {
    error?: string;
    code?: string;
    message?: string;
  };
  if (!response.ok) {
    throw new ApiError(
      response.status,
      result.error ?? result.code ?? "request_failed",
    );
  }
  return result;
}
export function friendly(error: unknown) {
  if (!(error instanceof ApiError))
    return "We could not connect. Your unsaved text is still here. Please retry.";
  const messages: Record<string, string> = {
    revision_conflict:
      "This record changed in another session. Your unsaved text is preserved. Open the latest version in a new tab, compare, then reload when you are ready.",
    mail_unavailable: "Email is currently unavailable. Please try again later.",
    writes_disabled:
      "Changes are currently unavailable. Your text has not been saved.",
    file_type_invalid: "Choose a genuine PDF, JPEG, PNG, or WebP file.",
    file_size_invalid: "Choose a file between 1 byte and 8 MiB.",
    body_too_large: "This file or request is too large.",
    profile_archived: "Restore this profile before editing or choosing it.",
    not_found: "This record is unavailable.",
    draft_busy: "This draft is being processed. Please retry later.",
    generation_unavailable:
      "Draft generation is unavailable. Your text is preserved.",
    generation_limit_or_conflict:
      "A request limit or concurrent change prevented this request. Review request status and refresh details while keeping your edits.",
    idempotency_conflict:
      "This request key already names another selection. Choose the profile version again to start a new request.",
    profile_evidence_required:
      "Add profile evidence before requesting a draft.",
    profile_evidence_too_long:
      "No profile evidence fits the 6,000-character limit per field. Shorten a summary, experience or education field, or add concise evidence, then choose the new profile version.",
    profile_content_unsupported:
      "This profile uses unsupported legacy content. Create a fresh profile with the evidence you want to use.",
    resume_extraction_unavailable:
      "Resume extraction is unavailable. Add its relevant evidence to your profile and request without a file.",
    draft_not_approvable:
      "Only a reviewable draft with content can be approved.",
    invalid_request: "Check the fields and their limits, then retry.",
    invalid_status_transition:
      "That status change is unavailable. Review the latest saved job.",
    INVALID_EMAIL_OR_PASSWORD: "The email or password is incorrect.",
    EMAIL_NOT_VERIFIED:
      "Verify your email before signing in. You can request another verification message below.",
    INVALID_PASSWORD: "Your current password is incorrect.",
    INVALID_TOKEN: "This link is expired or has already been used.",
    PASSWORD_TOO_SHORT: "Use a password of at least 12 characters.",
    TOO_MANY_REQUESTS: "Too many attempts. Please wait a minute and retry.",
  };
  return (
    messages[error.code] ??
    (error.status === 429
      ? "Too many attempts. Please wait a minute and retry."
      : "The request did not complete. Your unsaved text is preserved. Please retry.")
  );
}
export function useResource<T>(path: string) {
  const [data, setData] = useState<T>(),
    [error, setError] = useState<unknown>(),
    [loading, setLoading] = useState(true),
    [nonce, setNonce] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(undefined);
    void api<T>(path)
      .then((v) => {
        if (live) setData(v);
      })
      .catch((e) => {
        if (live) setError(e);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [path, nonce]);
  return { data, error, loading, reload: () => setNonce((n) => n + 1) };
}
export function safeNext(value: string | null) {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  )
    return "/";
  try {
    const url = new URL(value, location.origin);
    if (url.origin !== location.origin) return "/";
    if (
      // /consent is included so signing in mid-authorization returns the user
      // to the pending request. It stays subject to every check above: same
      // origin, a single leading slash and no backslash, so this widens the
      // destination set without weakening the callback rules themselves.
      !/^\/(?:jobs(?:\/[^/]+)?|saved-jobs\/[^/]+|profile|onboarding|account|consent|job-details|saved-job-details)?$/.test(
        url.pathname,
      )
    )
      return "/";
    return url.pathname + url.search;
  } catch {
    return "/";
  }
}
