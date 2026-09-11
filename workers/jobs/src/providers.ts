import { z } from "zod";
import { htmlToPlainText } from "./html-text.ts";

export const sources = [
  "greenhouse:anthropic",
  "greenhouse:stripe",
  "greenhouse:figma",
  "fantastic:active-ats",
  "jobven:public-jobs",
] as const;
export const sourceSchema = z.enum(sources);
export type Source = z.infer<typeof sourceSchema>;
export class IngestionError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}
export const failureCode = (e: unknown) =>
  e instanceof IngestionError ? e.code : "internal_error";
const nullableText = z.string().nullish();
const looseObject = z.record(z.string(), z.unknown());
const id = z
  .union([z.string().min(1), z.number().int().nonnegative()])
  .transform(String);
const common = { id, title: z.string().trim().min(1) };
const greenhouse = z
  .object({
    ...common,
    absolute_url: z.url(),
    content: z.string(),
    location: z.object({ name: nullableText }).passthrough().nullish(),
    company_name: nullableText,
    metadata: z.array(looseObject).nullish(),
    departments: z.array(looseObject).nullish(),
  })
  .passthrough();
const fantastic = z
  .object({
    ...common,
    url: z.url(),
    description_text: z.string(),
    organization: nullableText,
    locations_derived: z.array(z.string()).nullish(),
    ai_salary_min_value: z.number().nullish(),
    ai_salary_max_value: z.number().nullish(),
    ai_salary_value: z.number().nullish(),
    ai_salary_currency: nullableText,
    ai_salary_unit_text: nullableText,
  })
  .passthrough();
const jobven = z
  .object({
    ...common,
    applyUrl: z.url().nullish(),
    status: z.enum(["active", "closed", "expired"]),
    descriptionPlain: z.string(),
    companies: z.array(looseObject),
    locations: z.array(looseObject).nullish(),
    salary: z
      .object({
        min: z.number().nullish(),
        max: z.number().nullish(),
        currency: nullableText,
        period: nullableText,
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();
export interface NormalizedJob {
  externalId: string;
  canonicalUrl: string | null;
  core: {
    title: string;
    company: string | null;
    location: string | null;
    remote: string | null;
    employment: string | null;
    seniority: string | null;
    source_url: string | null;
    description: string;
    status: string;
  };
  salary: {
    min: number | null;
    max: number | null;
    currency: string | null;
    period: string | null;
    provenance: string;
  };
  tags: string[];
  locations: unknown[];
  companies: unknown[];
  provenance: {
    source: Source;
    normalizer: string;
    inferred: Record<string, string>;
  };
  sourceFields: Record<string, unknown>;
}
function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function strings(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((s): s is string => typeof s === "string")
    : [];
}
// Reuse only demonstrably job-specific HTTPS URLs. Query requisitions are retained verbatim.
export function canonicalJobUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password) return null;
    const uuid =
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
    const requisition = /^(?:REQ|JR|R)[-_]?\d+[A-Za-z0-9_-]*$/;
    const identifier = (value: string) =>
      /^\d+$/.test(value) || uuid.test(value) || requisition.test(value);
    const segments = u.pathname
      .split("/")
      .filter(Boolean)
      .map(decodeURIComponent);
    const leaf = segments.at(-1) ?? "";
    const generic = segments.some((segment) =>
      /^(search|all|category|categories|browse|filter)$/i.test(segment),
    );
    const jobPath = segments.some((segment) =>
      /^(jobs?|positions?|postings?|requisitions?)$/i.test(segment),
    );
    // Text after /jobs alone is not identity evidence. Accept a positive ID in a
    // job path, an opaque UUID (e.g. Lever), or an explicitly named query ID.
    const specific =
      (!generic && ((jobPath && identifier(leaf)) || uuid.test(leaf))) ||
      [...u.searchParams].some(
        ([key, value]) =>
          /^(gh_jid|jobid|job_id|requisitionid|requisition_id|reqid|req_id)$/i.test(
            key,
          ) && identifier(value),
      );
    if (!specific) return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}
export function normalize(source: Source, value: unknown): NormalizedJob {
  const provider = source.split(":")[0];
  const parsed = (
    provider === "greenhouse"
      ? greenhouse
      : provider === "fantastic"
        ? fantastic
        : jobven
  ).safeParse(value);
  if (!parsed.success) throw new IngestionError("invalid_record");
  const r: Record<string, unknown> = parsed.data;
  const title = String(r.title),
    inferred: Record<string, string> = {};
  const url = text(r.absolute_url ?? r.url ?? r.applyUrl);
  const locations =
    provider === "greenhouse"
      ? r.location
        ? [r.location]
        : []
      : Array.isArray(r.locations_derived ?? r.locations)
        ? ((r.locations_derived ?? r.locations) as unknown[])
        : [];
  const companies = Array.isArray(r.companies) ? r.companies : [];
  const company =
    text(
      r.company_name ??
        r.organization ??
        (companies[0] as Record<string, unknown> | undefined)?.name,
    ) ?? (provider === "greenhouse" ? source.split(":")[1] : null);
  if (provider === "greenhouse" && !text(r.company_name))
    inferred.company = "board-token";
  const location =
    locations
      .map((v) =>
        typeof v === "string"
          ? v
          : Object.entries(v as Record<string, unknown>)
              .filter(([k]) =>
                [
                  "name",
                  "addressLocality",
                  "addressRegion",
                  "addressCountry",
                ].includes(k),
              )
              .map(([, v]) => text(v))
              .filter(Boolean)
              .join(", "),
      )
      .filter(Boolean)
      .join(" | ") || null;
  const metadata = Array.isArray(r.metadata)
    ? (r.metadata as Record<string, unknown>[])
    : [];
  const remoteValue = text(
    r.remoteType ??
      r.ai_work_arrangement ??
      metadata.find((m) => m.name === "Location Type")?.value,
  );
  const remoteMap: Record<string, string> = {
    remote: "Remote",
    "remote ok": "Remote",
    "remote solely": "Remote",
    hybrid: "Hybrid",
    onsite: "On-site",
    "on-site": "On-site",
  };
  let remote = remoteValue
    ? (remoteMap[remoteValue.toLowerCase()] ?? null)
    : null;
  if (!remote && /\bremote\b/i.test(location ?? "")) {
    remote = "Remote";
    inferred.remote = "location-text-heuristic";
  }
  const seniorityMap: Record<string, string> = {
    entry: "Junior",
    junior: "Junior",
    mid: "Mid",
    senior: "Senior",
    lead: "Lead",
    staff: "Lead",
    principal: "Lead",
    manager: "Manager",
    director: "Director",
    executive: "Executive",
    "0-2": "Junior",
    "2-5": "Mid",
    "5-10": "Senior",
    "10+": "Lead",
  };
  const level = text(r.experienceLevel ?? r.ai_experience_level);
  let seniority = level ? (seniorityMap[level.toLowerCase()] ?? null) : null;
  if (!seniority)
    for (const [pattern, label] of [
      [/\b(intern|internship)\b/i, "Internship"],
      [/\b(chief|cto|ceo|vp|vice president|head of)\b/i, "Executive"],
      [/\bdirector\b/i, "Director"],
      [/\b(senior|sr\.?)(?:\b|$)/i, "Senior"],
      [/\b(lead|staff|principal)\b/i, "Lead"],
      [/\b(junior|associate|entry|new grad)\b/i, "Junior"],
    ] as const) {
      if (pattern.test(title)) {
        seniority = label;
        inferred.seniority = "title-heuristic";
        break;
      }
    }
  const tags = strings(r.ai_taxonomies_a);
  if (provider !== "fantastic")
    for (const [pattern, label] of [
      [/engineer|software|developer/i, "Engineering"],
      [/\bdata\b|analytics/i, "Data Science"],
      [/machine learning|\bml\b|\bai\b/i, "Machine Learning"],
      [/design|\bux\b/i, "Design"],
    ] as const) {
      if (pattern.test(title)) {
        tags.push(label);
        inferred.tags = "title-heuristic";
      }
    }
  if (provider === "fantastic") {
    if (remoteValue) inferred.remote = "provider-ai";
    if (level) inferred.seniority = "provider-ai";
    inferred.tags = "provider-ai";
  }
  const s = (r.salary ?? {}) as Record<string, unknown>;
  const salary =
    provider === "fantastic"
      ? {
          min: r.ai_salary_min_value ?? r.ai_salary_value,
          max: r.ai_salary_max_value ?? r.ai_salary_value,
          currency: r.ai_salary_currency,
          period: r.ai_salary_unit_text,
        }
      : s;
  return {
    externalId: String(r.id),
    canonicalUrl: canonicalJobUrl(url),
    core: {
      title,
      company,
      location,
      remote,
      seniority,
      employment:
        text(r.employmentType) ??
        (strings(r.ai_employment_type).join(", ") || null),
      source_url: url,
      description:
        provider === "greenhouse"
          ? htmlToPlainText(String(r.content))
          : String(r.description_text ?? r.descriptionPlain),
      status:
        r.status === "closed" || r.status === "expired" ? "Closed" : "Open",
    },
    salary: {
      min: typeof salary.min === "number" ? salary.min : null,
      max: typeof salary.max === "number" ? salary.max : null,
      currency: text(salary.currency),
      period: text(salary.period),
      provenance: provider === "fantastic" ? "provider-ai" : "source",
    },
    tags,
    locations,
    companies,
    provenance: { source, normalizer: "ingestion-v1", inferred },
    sourceFields: r,
  };
}
export interface Page {
  rows: unknown[];
  nextCursor: string | null;
  complete: boolean;
}
export function parsePage(
  source: Source,
  value: unknown,
  cursor: string | null,
): Page {
  if (source.startsWith("greenhouse:")) {
    const p = z
      .object({
        jobs: z.array(z.unknown()),
        meta: z.object({ total: z.number().int().nonnegative() }),
      })
      .safeParse(value);
    if (!p.success || p.data.jobs.length !== p.data.meta.total)
      throw new IngestionError("invalid_snapshot_count");
    return { rows: p.data.jobs, nextCursor: null, complete: true };
  }
  if (source.startsWith("fantastic:")) {
    if (!Array.isArray(value) || value.length > 50)
      throw new IngestionError("invalid_page");
    return {
      rows: value,
      nextCursor:
        value.length === 50 ? String(Number(cursor ?? "0") + 50) : null,
      complete: value.length < 50,
    };
  }
  const p = z
    .object({
      data: z.array(z.unknown()).max(25),
      meta: z.object({
        count: z.number().int().nonnegative(),
        hasMore: z.boolean(),
        nextCursor: z.string().min(1).nullable(),
      }),
    })
    .safeParse(value);
  if (
    !p.success ||
    p.data.meta.count !== p.data.data.length ||
    p.data.meta.hasMore !== (p.data.meta.nextCursor !== null) ||
    (p.data.meta.hasMore &&
      (!p.data.data.length || p.data.meta.nextCursor === cursor))
  )
    throw new IngestionError("invalid_pagination");
  return {
    rows: p.data.data,
    nextCursor: p.data.meta.nextCursor,
    complete: !p.data.meta.hasMore,
  };
}
export interface ProviderSecrets {
  FANTASTIC_AUTHORIZATION?: string;
  JOBVEN_API_KEY?: string;
}
export function providerRequest(
  source: Source,
  cursor: string | null,
  secrets: ProviderSecrets,
) {
  const headers = new Headers({ Accept: "application/json" });
  let url: URL;
  if (source.startsWith("greenhouse:"))
    url = new URL(
      `https://boards-api.greenhouse.io/v1/boards/${source.split(":")[1]}/jobs?content=true`,
    );
  else if (source.startsWith("fantastic:")) {
    if (!secrets.FANTASTIC_AUTHORIZATION)
      throw new IngestionError("missing_credentials");
    headers.set("Authorization", secrets.FANTASTIC_AUTHORIZATION);
    url = new URL("https://data.fantastic.jobs/v1/active-ats");
    for (const [k, v] of Object.entries({
      time_frame: "24h",
      limit: "50",
      offset: cursor ?? "0",
      description_format: "text",
      include_basic_organization_details: "true",
      ai_taxonomies_a: "Software,Technology,Data & Analytics",
    }))
      url.searchParams.set(k, v);
  } else {
    if (!secrets.JOBVEN_API_KEY)
      throw new IngestionError("missing_credentials");
    headers.set("X-API-Key", secrets.JOBVEN_API_KEY);
    url = new URL(
      "https://api.jobven.com/v1/public/jobs?limit=25&descriptionFormat=plain",
    );
    for (const skill of [
      "Python",
      "JavaScript",
      "TypeScript",
      "React",
      "Node.js",
      "AWS",
      "Docker",
      "Kubernetes",
      "SQL",
      "Go",
      "Java",
      "Machine Learning",
    ])
      url.searchParams.append("skills[]", skill);
    if (cursor) url.searchParams.set("cursor", cursor);
  }
  return { url, headers };
}
export interface FetchLimits {
  timeoutMs: number;
  maxBytes: number;
  maxAttempts?: number;
  retryDelayMs?: number;
}
export async function fetchPage(
  source: Source,
  cursor: string | null,
  secrets: ProviderSecrets,
  fetcher: typeof fetch = fetch,
  limits: FetchLimits = { timeoutMs: 20000, maxBytes: 16 * 1024 * 1024 },
) {
  const attempts = Math.min(3, Math.max(1, limits.maxAttempts ?? 3));
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetchOnce(source, cursor, secrets, fetcher, limits);
    } catch (e) {
      if (
        i + 1 === attempts ||
        ![
          "http_429",
          "http_500",
          "http_502",
          "http_503",
          "http_504",
          "fetch_timeout",
          "fetch_failed",
        ].includes(failureCode(e))
      )
        throw e;
      await new Promise((resolve) =>
        setTimeout(resolve, (limits.retryDelayMs ?? 500) * 2 ** i),
      );
    }
  }
  throw new IngestionError("fetch_attempts_exhausted");
}
async function fetchOnce(
  source: Source,
  cursor: string | null,
  secrets: ProviderSecrets,
  fetcher: typeof fetch,
  limits: FetchLimits,
) {
  const req = providerRequest(source, cursor, secrets),
    controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), limits.timeoutMs);
  try {
    const response = await fetcher(req.url, {
      headers: req.headers,
      signal: controller.signal,
      redirect: "error",
    });
    if (!response.ok) throw new IngestionError(`http_${response.status}`);
    if (Number(response.headers.get("content-length")) > limits.maxBytes)
      throw new IngestionError("response_bytes_limit");
    const reader = response.body?.getReader();
    if (!reader) throw new IngestionError("empty_body");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      const chunk: unknown = r.value;
      if (!(chunk instanceof Uint8Array))
        throw new IngestionError("invalid_body_chunk");
      bytes += chunk.byteLength;
      if (bytes > limits.maxBytes) {
        await reader.cancel();
        throw new IngestionError("response_bytes_limit");
      }
      chunks.push(chunk);
    }
    const result = new Uint8Array(bytes);
    let offset = 0;
    for (const c of chunks) {
      result.set(c, offset);
      offset += c.length;
    }
    return result;
  } catch (e) {
    if (controller.signal.aborted) throw new IngestionError("fetch_timeout");
    if (e instanceof IngestionError) throw e;
    throw new IngestionError("fetch_failed");
  } finally {
    clearTimeout(timeout);
  }
}
export async function sha256(value: string | Uint8Array) {
  const data =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
