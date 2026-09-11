type GrantEpoch = { epoch: number; active: number };

const INTENT_TTL_MS = 10 * 60 * 1000;

export async function oauthTokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Captures the server-side grant generation against which the maintained OAuth
 * provider may later persist an authorization code. Request values only bind
 * the intent to that exact continuation; user, session, and epoch are resolved
 * from authenticated server state.
 */
export async function recordAuthorizationIntent(
  db: D1Database,
  userId: string,
  sessionId: string,
  rawQuery: string,
): Promise<void> {
  if (!rawQuery || rawQuery.length > 16_384) return;
  const query = new URLSearchParams(rawQuery);
  const clientId = query.get("client_id") ?? "";
  const codeChallenge = query.get("code_challenge") ?? "";
  const redirectUri = query.get("redirect_uri") ?? "";
  const resource = query.get("resource") ?? "";
  const scope = query.get("scope") ?? "";
  const state = query.get("state") ?? "";
  if (
    !clientId ||
    !codeChallenge ||
    query.get("code_challenge_method") !== "S256" ||
    !redirectUri ||
    !resource ||
    !scope ||
    clientId.length > 512 ||
    codeChallenge.length > 512 ||
    redirectUri.length > 2048 ||
    resource.length > 2048 ||
    scope.length > 2048 ||
    state.length > 2048
  )
    return;

  const client = await db
    .prepare(
      "SELECT clientId FROM oauthClient WHERE clientId=? AND disabled IS NOT 1",
    )
    .bind(clientId)
    .first<{ clientId: string }>();
  if (!client) return;
  const current = await db
    .prepare(
      "SELECT epoch,active FROM oauthGrantEpoch WHERE userId=? AND clientId=?",
    )
    .bind(userId, clientId)
    .first<GrantEpoch>();
  const consent = await db
    .prepare(
      "SELECT 1 AS present FROM oauthConsent WHERE userId=? AND clientId=? LIMIT 1",
    )
    .bind(userId, clientId)
    .first<{ present: number }>();

  // If consent already exists, this authorize execution belongs to the current
  // active generation. Otherwise only the next explicit consent can activate
  // it. A later re-consent advances the epoch again, so an old intent cannot
  // inherit new authority.
  const expectedEpoch = consent
    ? current?.active === 1
      ? current.epoch
      : 0
    : (current?.epoch ?? 0) + 1;
  if (expectedEpoch <= 0) return;
  const signedExpiry = Number(query.get("exp"));
  const expiresAt = Math.min(
    Date.now() + INTENT_TTL_MS,
    Number.isFinite(signedExpiry) && signedExpiry > 0
      ? signedExpiry * 1000
      : Number.POSITIVE_INFINITY,
  );
  if (expiresAt <= Date.now()) return;
  await db
    .prepare(
      "INSERT INTO oauthAuthorizationIntent(userId,clientId,sessionId,codeChallenge,redirectUri,resource,scope,state,expectedEpoch,expiresAt) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(userId,clientId,sessionId,codeChallenge) DO UPDATE SET redirectUri=excluded.redirectUri,resource=excluded.resource,scope=excluded.scope,state=excluded.state,expectedEpoch=excluded.expectedEpoch,expiresAt=excluded.expiresAt",
    )
    .bind(
      userId,
      clientId,
      sessionId,
      codeChallenge,
      redirectUri,
      resource,
      scope,
      state,
      expectedEpoch,
      expiresAt,
    )
    .run();
}

export async function isCurrentGrantAccessToken(
  db: D1Database,
  rawToken: string,
): Promise<boolean> {
  const token = await oauthTokenHash(rawToken);
  const row = await db
    .prepare(
      "SELECT 1 AS active FROM oauthAccessToken t JOIN oauthAuthorizationCodeGrant c ON c.authorizationCodeId=t.authorizationCodeId AND c.userId=t.userId AND c.clientId=t.clientId AND c.sessionId=t.sessionId JOIN oauthGrantEpoch g ON g.userId=c.userId AND g.clientId=c.clientId AND g.epoch=c.epoch WHERE t.token=? AND g.active=1 LIMIT 1",
    )
    .bind(token)
    .first<{ active: number }>();
  return row?.active === 1;
}
