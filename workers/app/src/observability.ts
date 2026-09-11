import { mcpToolMeta } from "../../../packages/domain/src/mcp";

// A closed set of event names. An operator dashboard can rely on these; adding
// a new one is a deliberate code change, not an accident of string building.
export const OPS_EVENTS = [
  "mcp_auth_rejected",
  "mcp_tool_rejected",
  "mcp_call_completed",
  "connected_app_revoked",
] as const;
export type OpsEvent = (typeof OPS_EVENTS)[number];

// Why a request was refused. Finite, so a reason can never carry a token, a
// record value or an exception message.
export const OPS_REASONS = [
  "missing_or_invalid_token",
  "wrong_audience",
  "account_unavailable",
  "insufficient_scope",
  "writes_disabled",
  "mcp_writes_disabled",
  "mcp_generation_disabled",
  "mcp_review_disabled",
  "invalid_request",
  "internal_error",
  "user_revoked",
] as const;
export type OpsReason = (typeof OPS_REASONS)[number];

/**
 * Structured operational log.
 *
 * Redaction is by construction rather than by filtering: the only values that
 * can be emitted are a name from a closed list, an opaque client id, a tool name
 * that must already be registered, and numbers. There is deliberately no field
 * for a token, a URL, a record, provider output or an exception message, so no
 * caller can pass one in by mistake.
 */
export function logOps(
  event: OpsEvent,
  fields: {
    reason?: OpsReason;
    clientId?: string;
    tool?: string;
    status?: number;
    durationMs?: number;
    count?: number;
  } = {},
) {
  const payload: Record<string, string | number> = { event };
  if (fields.reason && OPS_REASONS.includes(fields.reason))
    payload.reason = fields.reason;
  // Client ids are server-generated opaque identifiers. Bound the length so a
  // hostile registration cannot write an unbounded line into the log.
  if (fields.clientId && /^[A-Za-z0-9_-]{1,64}$/.test(fields.clientId))
    payload.clientId = fields.clientId;
  if (
    fields.tool &&
    Object.prototype.hasOwnProperty.call(mcpToolMeta, fields.tool)
  )
    payload.tool = fields.tool;
  for (const key of ["status", "durationMs", "count"] as const) {
    const value = fields[key];
    if (typeof value === "number" && Number.isFinite(value))
      payload[key] = Math.trunc(value);
  }
  console.log(JSON.stringify(payload));
  return payload;
}
