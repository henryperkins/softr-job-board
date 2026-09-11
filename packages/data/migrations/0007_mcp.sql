-- Additive OAuth 2.1 authorization-server storage for the user-scoped MCP server.
-- Table and column names are not invented: they are the resolved schema reported by
-- better-auth/db getAuthTables() for the configured @better-auth/mcp plugin, so the
-- adapter finds exactly the fields it writes. Migrations 0001-0006 are unchanged.
--
-- Access tokens are opaque (disableJwtPlugin), so oauth_access_token holds real rows
-- whose deletion or `revoked` stamp takes effect on the very next request. That is what
-- makes revocation durable; a JWT would be unrevocable because it is never stored.
PRAGMA foreign_keys = ON;

CREATE TABLE oauthClient (id TEXT PRIMARY KEY, clientId TEXT NOT NULL UNIQUE, clientSecret TEXT, clientDiscoveryId TEXT, disabled INTEGER, skipConsent INTEGER, enableEndSession INTEGER, subjectType TEXT, scopes TEXT, clientCredentialsScopes TEXT, userId TEXT REFERENCES auth_user(id) ON DELETE CASCADE, createdAt INTEGER, updatedAt INTEGER, name TEXT, uri TEXT, icon TEXT, contacts TEXT, tos TEXT, policy TEXT, softwareId TEXT, softwareVersion TEXT, softwareStatement TEXT, redirectUris TEXT NOT NULL, postLogoutRedirectUris TEXT, backchannelLogoutUri TEXT, backchannelLogoutSessionRequired INTEGER, tokenEndpointAuthMethod TEXT, applicationType TEXT, jwks TEXT, jwksUri TEXT, grantTypes TEXT, responseTypes TEXT, requirePKCE INTEGER, dpopBoundAccessTokens INTEGER, referenceId TEXT, metadata TEXT);
CREATE INDEX oauth_client_owner ON oauthClient(userId);

CREATE TABLE oauthResource (id TEXT PRIMARY KEY, identifier TEXT NOT NULL UNIQUE, name TEXT NOT NULL, accessTokenTtl INTEGER, refreshTokenTtl INTEGER, signingAlgorithm TEXT, signingKeyId TEXT, allowedScopes TEXT, customClaims TEXT, dpopBoundAccessTokensRequired INTEGER, disabled INTEGER, createdAt INTEGER, updatedAt INTEGER, policyVersion INTEGER, metadata TEXT);

CREATE TABLE oauthClientResource (id TEXT PRIMARY KEY, clientId TEXT NOT NULL REFERENCES oauthClient(clientId) ON DELETE CASCADE, resourceId TEXT NOT NULL REFERENCES oauthResource(identifier) ON DELETE CASCADE, metadata TEXT, createdAt INTEGER, UNIQUE(clientId, resourceId));

-- refreshId on the access token is intentionally an unconstrained column: the provider
-- may write the access token before the refresh token row inside one issuance, so a
-- foreign key here would reject a legitimate grant rather than protect anything.
CREATE TABLE oauthRefreshToken (id TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE, clientId TEXT NOT NULL REFERENCES oauthClient(clientId) ON DELETE CASCADE, sessionId TEXT REFERENCES auth_session(id) ON DELETE CASCADE, userId TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE, referenceId TEXT, authorizationCodeId TEXT, resources TEXT, requestedUserInfoClaims TEXT, expiresAt INTEGER, createdAt INTEGER, revoked INTEGER, rotatedAt INTEGER, rotationReplayResponse TEXT, rotationReplayExpiresAt INTEGER, authTime INTEGER, confirmation TEXT, scopes TEXT NOT NULL);
CREATE INDEX oauth_refresh_owner ON oauthRefreshToken(userId, clientId);

CREATE TABLE oauthAccessToken (id TEXT PRIMARY KEY, token TEXT UNIQUE, clientId TEXT NOT NULL REFERENCES oauthClient(clientId) ON DELETE CASCADE, sessionId TEXT REFERENCES auth_session(id) ON DELETE CASCADE, userId TEXT REFERENCES auth_user(id) ON DELETE CASCADE, referenceId TEXT, authorizationCodeId TEXT, resources TEXT, requestedUserInfoClaims TEXT, refreshId TEXT, expiresAt INTEGER, createdAt INTEGER, revoked INTEGER, confirmation TEXT, scopes TEXT NOT NULL);
CREATE INDEX oauth_access_owner ON oauthAccessToken(userId, clientId);
CREATE INDEX oauth_access_refresh ON oauthAccessToken(refreshId);

CREATE TABLE oauthConsent (id TEXT PRIMARY KEY, clientId TEXT NOT NULL REFERENCES oauthClient(clientId) ON DELETE CASCADE, userId TEXT REFERENCES auth_user(id) ON DELETE CASCADE, referenceId TEXT, resources TEXT, requestedUserInfoClaims TEXT, scopes TEXT NOT NULL, createdAt INTEGER, updatedAt INTEGER);
CREATE INDEX oauth_consent_owner ON oauthConsent(userId, clientId);

CREATE TABLE oauthClientAssertion (id TEXT PRIMARY KEY, expiresAt INTEGER NOT NULL);

-- Application grant epochs close the two provider ordering gaps around
-- authorization-code and token persistence. An intent captures the active
-- user/client/session grant before the provider continues. Code and token rows
-- can then be persisted only while that exact epoch is still active.
-- D1's remote SQL splitter misreads CASE ... END inside trigger definitions.
-- Use equivalent boolean expressions, iif(), and RAISE ... WHERE instead.
CREATE TABLE oauthGrantEpoch (
 userId TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
 clientId TEXT NOT NULL REFERENCES oauthClient(clientId) ON DELETE CASCADE,
 epoch INTEGER NOT NULL CHECK(epoch>0), active INTEGER NOT NULL CHECK(active IN (0,1)),
 updatedAt INTEGER NOT NULL, PRIMARY KEY(userId,clientId)
);
CREATE TABLE oauthAuthorizationIntent (
 userId TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
 clientId TEXT NOT NULL REFERENCES oauthClient(clientId) ON DELETE CASCADE,
 sessionId TEXT NOT NULL REFERENCES auth_session(id) ON DELETE CASCADE,
 codeChallenge TEXT NOT NULL, redirectUri TEXT NOT NULL, resource TEXT NOT NULL,
 scope TEXT NOT NULL, state TEXT NOT NULL, expectedEpoch INTEGER NOT NULL,
 expiresAt INTEGER NOT NULL,
 PRIMARY KEY(userId,clientId,sessionId,codeChallenge)
);
CREATE INDEX oauth_authorization_intent_expiry ON oauthAuthorizationIntent(expiresAt);
CREATE TABLE oauthAuthorizationCodeGrant (
 authorizationCodeId TEXT PRIMARY KEY,
 userId TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
 clientId TEXT NOT NULL REFERENCES oauthClient(clientId) ON DELETE CASCADE,
 sessionId TEXT NOT NULL REFERENCES auth_session(id) ON DELETE CASCADE,
 epoch INTEGER NOT NULL, createdAt INTEGER NOT NULL
);
CREATE INDEX oauth_authorization_code_grant_owner ON oauthAuthorizationCodeGrant(userId,clientId,epoch);

CREATE TRIGGER oauth_consent_activates_grant AFTER INSERT ON oauthConsent
WHEN NEW.userId IS NOT NULL
BEGIN
 INSERT INTO oauthGrantEpoch(userId,clientId,epoch,active,updatedAt)
 VALUES(NEW.userId,NEW.clientId,1,1,unixepoch()*1000)
 ON CONFLICT(userId,clientId) DO UPDATE SET
  epoch=oauthGrantEpoch.epoch+(oauthGrantEpoch.active=0),
  active=1,updatedAt=unixepoch()*1000;
END;

CREATE TRIGGER oauth_consent_deactivates_grant AFTER DELETE ON oauthConsent
WHEN OLD.userId IS NOT NULL
BEGIN
 UPDATE oauthGrantEpoch SET
  active=EXISTS(SELECT 1 FROM oauthConsent WHERE userId=OLD.userId AND clientId=OLD.clientId),
  updatedAt=unixepoch()*1000
 WHERE userId=OLD.userId AND clientId=OLD.clientId;
END;

CREATE TRIGGER oauth_authorization_code_requires_active_grant BEFORE INSERT ON auth_verification
WHEN json_extract(iif(json_valid(NEW.value),NEW.value,'{}'),'$.type')='authorization_code'
BEGIN
 SELECT RAISE(ABORT,'oauth_grant_inactive') WHERE NOT EXISTS(
  SELECT 1 FROM oauthAuthorizationIntent i
  JOIN oauthGrantEpoch g ON g.userId=i.userId AND g.clientId=i.clientId
  WHERE i.userId=json_extract(NEW.value,'$.userId')
   AND i.clientId=json_extract(NEW.value,'$.query.client_id')
   AND i.sessionId=json_extract(NEW.value,'$.sessionId')
   AND i.codeChallenge=json_extract(NEW.value,'$.query.code_challenge')
   AND i.redirectUri=json_extract(NEW.value,'$.query.redirect_uri')
   AND i.resource=COALESCE(json_extract(NEW.value,'$.resource[0]'),json_extract(NEW.value,'$.resource'),json_extract(NEW.value,'$.query.resource[0]'),json_extract(NEW.value,'$.query.resource'),'')
   AND i.scope=COALESCE(json_extract(NEW.value,'$.query.scope'),'')
   AND i.state=COALESCE(json_extract(NEW.value,'$.query.state'),'')
   AND i.expiresAt>=unixepoch()*1000
   AND i.expectedEpoch=g.epoch AND g.active=1
 );
END;

CREATE TRIGGER oauth_authorization_code_binds_grant AFTER INSERT ON auth_verification
WHEN json_extract(iif(json_valid(NEW.value),NEW.value,'{}'),'$.type')='authorization_code'
BEGIN
 INSERT INTO oauthAuthorizationCodeGrant(authorizationCodeId,userId,clientId,sessionId,epoch,createdAt)
 SELECT NEW.identifier,i.userId,i.clientId,i.sessionId,i.expectedEpoch,unixepoch()*1000
 FROM oauthAuthorizationIntent i
 WHERE i.userId=json_extract(NEW.value,'$.userId')
  AND i.clientId=json_extract(NEW.value,'$.query.client_id')
  AND i.sessionId=json_extract(NEW.value,'$.sessionId')
  AND i.codeChallenge=json_extract(NEW.value,'$.query.code_challenge');
 DELETE FROM oauthAuthorizationIntent
 WHERE userId=json_extract(NEW.value,'$.userId')
  AND clientId=json_extract(NEW.value,'$.query.client_id')
  AND sessionId=json_extract(NEW.value,'$.sessionId')
  AND codeChallenge=json_extract(NEW.value,'$.query.code_challenge');
END;

CREATE TRIGGER oauth_access_token_requires_active_grant BEFORE INSERT ON oauthAccessToken
WHEN NEW.userId IS NOT NULL
BEGIN
 SELECT RAISE(ABORT,'oauth_grant_inactive') WHERE NOT EXISTS(
  SELECT 1 FROM oauthAuthorizationCodeGrant c
  JOIN oauthGrantEpoch g ON g.userId=c.userId AND g.clientId=c.clientId
  WHERE c.authorizationCodeId=NEW.authorizationCodeId
   AND c.userId=NEW.userId AND c.clientId=NEW.clientId
   AND c.sessionId=NEW.sessionId AND c.epoch=g.epoch AND g.active=1
 );
END;

CREATE TRIGGER oauth_refresh_token_requires_active_grant BEFORE INSERT ON oauthRefreshToken
BEGIN
 SELECT RAISE(ABORT,'oauth_grant_inactive') WHERE NOT EXISTS(
  SELECT 1 FROM oauthAuthorizationCodeGrant c
  JOIN oauthGrantEpoch g ON g.userId=c.userId AND g.clientId=c.clientId
  WHERE c.authorizationCodeId=NEW.authorizationCodeId
   AND c.userId=NEW.userId AND c.clientId=NEW.clientId
   AND c.sessionId=NEW.sessionId AND c.epoch=g.epoch AND g.active=1
 );
END;
