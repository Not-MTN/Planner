/**
 * Personal access tokens and the external API.
 *
 * Two surfaces live here because they share one table:
 *
 *  - Management (`/api/auth/api-tokens`) runs inside the signed-in app, so it
 *    keeps the same same-origin + session-cookie rules as every other auth
 *    route. The plaintext token is returned exactly once, when it is created.
 *
 *  - The external API (`/api/external/*`) is meant for a project the user runs
 *    themselves (a home automation script, a dashboard, a bot). It authenticates
 *    with `Authorization: Bearer <token>` instead of a cookie, and therefore is
 *    not bound to the browser's same-origin policy — server-to-server calls
 *    carry no Origin at all.
 *
 * The planner vault stays end-to-end encrypted either way. A token proves which
 * account is calling; reading or changing planner contents still needs the
 * account's vault key, which the server never holds. That split is the whole
 * security model: a leaked token can be revoked in settings without rotating
 * the encryption key, and a database dump contains only token hashes.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  API_TOKEN_EXPIRY_DAYS,
  API_TOKEN_LABEL_MAX,
  API_TOKEN_PREFIX,
  API_TOKEN_SCOPES,
  API_TOKENS_PER_ACCOUNT,
  MAX_VAULT_BODY_BYTES,
  MAX_VAULT_BYTES,
  type ApiTokenInfo,
  type ApiTokenScope,
} from '../shared/authContract.js';
import { hashToken, redactDatabaseError, type AuthStore, type ApiTokenRow, type UserRow } from './authStore.js';
import { readSessionToken } from './authApi.js';
import { isSameOriginRequest } from './groqProxy.js';
import { API_SECURITY_HEADERS, rateLimitResponse, type BodyTooLargeError } from './security.js';
import { readLimitedBody } from './security.js';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...API_SECURITY_HEADERS,
    },
  });
}

function error(status: number, message: string, code?: string): Response {
  return json(status, { error: { message, ...(code ? { code } : {}) } });
}

/** A fresh secret. The prefix makes a token recognizable in a config file. */
export function createApiTokenValue(): string {
  return `${API_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
}

/**
 * SHA-256 hex of the token. Stronger than the reversible base64 used for
 * session tokens: an access token may live for months in an external project,
 * so a database dump must not hand its bearer secret to whoever reads it.
 */
export function hashApiToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Pull the bearer secret out of the Authorization header, or null. */
export function readBearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const match = /^Bearer\s+([A-Za-z0-9._-]+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

function tokenInfo(row: ApiTokenRow): ApiTokenInfo {
  return {
    id: row.id,
    label: row.label,
    scope: row.scope,
    createdAt: new Date(row.created_at).toISOString(),
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
  };
}

async function readJson(request: Request, maxBytes: number): Promise<Record<string, unknown> | null> {
  try {
    const text = await readLimitedBody(request, maxBytes);
    return JSON.parse(text) as Record<string, unknown>;
  } catch (caught) {
    if ((caught as BodyTooLargeError)?.name === 'BodyTooLargeError') return null;
    return null;
  }
}

/* ----------------------------------------------------- token management UI */

/**
 * Session-authenticated management used by Settings: list, create, revoke.
 * Same-origin only, exactly like the rest of `/api/auth/*`.
 */
export async function handleApiTokens(request: Request, store: AuthStore | null): Promise<Response> {
  if (!isSameOriginRequest(request)) return error(403, 'Cross-origin requests are not allowed.');
  const limited = rateLimitResponse(request, 'auth-api-tokens', 60, 60_000);
  if (limited) return limited;
  if (!store) return error(503, 'The accounts database is not configured.', 'not_configured');

  const sessionToken = readSessionToken(request);
  if (!sessionToken) return error(401, 'Sign in first.', 'unauthenticated');

  try {
    const found = await store.findSession(hashToken(sessionToken));
    if (!found) return error(401, 'That session has expired. Please sign in again.', 'unauthenticated');
    const userId = found.user.id;

    if (request.method === 'GET') {
      const rows = await store.listApiTokens(userId);
      return json(200, { tokens: rows.filter((row) => !row.revoked_at).map(tokenInfo) });
    }

    if (request.method === 'POST') {
      const body = await readJson(request, 4 * 1024);
      if (!body) return error(400, 'Expected a JSON body.');
      const label = typeof body.label === 'string' ? body.label.trim().slice(0, API_TOKEN_LABEL_MAX) : '';
      const scope: ApiTokenScope | null = API_TOKEN_SCOPES.includes(body.scope as ApiTokenScope)
        ? (body.scope as ApiTokenScope)
        : null;
      if (!label) return error(400, 'Give the token a name so you remember what uses it.');
      if (!scope) return error(400, 'Choose either the read or the read-write scope.');
      const expiryChoice = typeof body.expiresInDays === 'number' ? body.expiresInDays : 0;
      if (!API_TOKEN_EXPIRY_DAYS.includes(expiryChoice as (typeof API_TOKEN_EXPIRY_DAYS)[number])) {
        return error(400, 'Choose one of the offered expiry periods.');
      }

      const existing = await store.listApiTokens(userId);
      if (existing.filter((row) => !row.revoked_at).length >= API_TOKENS_PER_ACCOUNT) {
        return error(409, `You can keep up to ${API_TOKENS_PER_ACCOUNT} active tokens. Revoke one first.`, 'limit');
      }

      const token = createApiTokenValue();
      const row = await store.createApiToken({
        id: randomUUID(),
        userId,
        label,
        tokenHash: hashApiToken(token),
        scope,
        expiresAt: expiryChoice === 0 ? null : new Date(Date.now() + expiryChoice * 24 * 60 * 60 * 1000),
      });
      if (!row) return error(409, 'That token could not be created. Try again.', 'conflict');
      // The only response that ever contains the secret.
      return json(201, { ...tokenInfo(row), token });
    }

    if (request.method === 'DELETE') {
      const body = await readJson(request, 2 * 1024);
      const id = typeof body?.id === 'string' && /^[a-f0-9-]{36}$/.test(body.id) ? body.id : null;
      if (!id) return error(400, 'Expected { id }.');
      const revoked = await store.revokeApiToken(id, userId);
      if (!revoked) return error(404, 'That token does not exist or was already revoked.', 'not_found');
      return json(200, { ok: true });
    }

    return error(405, 'Method not allowed.');
  } catch (caught) {
    console.error(`[planner] api token management failed: ${redactDatabaseError(caught)}`);
    return error(502, 'The accounts database could not be reached. Try again shortly.');
  }
}

/* ------------------------------------------------------------- external API */

interface AuthenticatedCall {
  token: ApiTokenRow;
  user: UserRow;
}

/**
 * Resolve a Bearer token to its account. Tokens carry no same-origin
 * requirement: the caller is typically a script on another machine, which
 * sends no Origin header. The token itself is the capability.
 */
async function authenticate(request: Request, store: AuthStore | null): Promise<AuthenticatedCall | Response> {
  if (!store) return error(503, 'The accounts database is not configured.', 'not_configured');
  const secret = readBearerToken(request);
  if (!secret) {
    return error(401, 'Missing bearer token. Use Authorization: Bearer <token>.', 'unauthenticated');
  }
  const limited = rateLimitResponse(request, `external-${request.method.toLowerCase()}`, 120, 60_000);
  if (limited) return limited;
  try {
    const found = await store.findApiToken(hashApiToken(secret));
    if (!found) return error(401, 'That token is unknown, expired or revoked.', 'unauthenticated');
    // Stamp usage best-effort; a failed stamp must not block the call.
    void store.touchApiToken(found.token.id).catch(() => {});
    return found;
  } catch (caught) {
    console.error(`[planner] external auth failed: ${redactDatabaseError(caught)}`);
    return error(502, 'The accounts database could not be reached. Try again shortly.');
  }
}

/** Proof that a token works: which account it belongs to and what it may do. */
export async function handleExternalMe(request: Request, store: AuthStore | null): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return error(405, 'Method not allowed.');
  const auth = await authenticate(request, store);
  if (auth instanceof Response) return auth;
  const { token, user } = auth;
  return json(200, {
    account: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
    },
    token: {
      id: token.id,
      label: token.label,
      scope: token.scope,
      expiresAt: token.expires_at ? new Date(token.expires_at).toISOString() : null,
    },
  });
}

/**
 * Read or write the account's encrypted vault through a token, with the same
 * optimistic-concurrency contract the apps use: PUT sends the base version and
 * either wins the next version or gets the current blob back with a 409.
 */
export async function handleExternalVault(request: Request, store: AuthStore | null): Promise<Response> {
  const auth = await authenticate(request, store);
  if (auth instanceof Response) return auth;
  const { token, user } = auth;

  try {
    if (request.method === 'GET') {
      const vault = await store!.getVault(user.id);
      if (!vault) return error(404, 'No vault yet.', 'not_found');
      return json(200, {
        version: vault.version,
        ciphertext: vault.ciphertext,
        updatedAt: new Date(vault.updated_at).toISOString(),
      });
    }

    if (request.method === 'PUT') {
      if (token.scope !== 'readwrite') {
        return error(403, 'This token is read-only. Create a read-write token to change planner data.', 'forbidden_scope');
      }
      const body = await readJson(request, MAX_VAULT_BODY_BYTES);
      if (!body) return error(400, 'Expected a JSON body.');
      const baseVersion =
        typeof body.baseVersion === 'number' && Number.isInteger(body.baseVersion) && body.baseVersion >= 0
          ? body.baseVersion
          : -1;
      const ciphertext = body.ciphertext;
      if (baseVersion < 0 || typeof ciphertext !== 'string' || !ciphertext || ciphertext.length > MAX_VAULT_BYTES * 2) {
        return error(400, 'Expected { baseVersion, ciphertext }.');
      }
      const next = await store!.putVault(user.id, baseVersion, ciphertext);
      if (next) {
        return json(200, {
          version: next.version,
          ciphertext: next.ciphertext,
          updatedAt: new Date(next.updated_at).toISOString(),
        });
      }
      const current = await store!.getVault(user.id);
      return json(409, {
        error: { message: 'Another device synced first.', code: 'conflict' },
        current: current
          ? {
              version: current.version,
              ciphertext: current.ciphertext,
              updatedAt: new Date(current.updated_at).toISOString(),
            }
          : null,
      });
    }

    return error(405, 'Method not allowed.');
  } catch (caught) {
    console.error(`[planner] external vault call failed: ${redactDatabaseError(caught)}`);
    return error(502, 'The accounts database could not be reached. Try again shortly.');
  }
}
