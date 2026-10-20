/**
 * Neon Realtime — live vault & sync propagation.
 *
 * How it works:
 *  1. Client asks POST /api/realtime/token → server mints a short JWT signed
 *     with NEON_REALTIME_SECRET (30s) containing userId.
 *  2. Client opens GET /api/realtime/events?since=… with Authorization: Bearer <jwt>
 *     or same-origin cookie — server verifies and returns pending events.
 *  3. On every vault/sync write (planner_vaults, planner_sync) we insert into
 *     planner_realtime_events and also do pg_notify. The poll endpoint reads it.
 *  4. Client auto-syncs: pullVault → mergeStates → pushVault if needed.
 *
 * Now covers EVERY part: vault (tasks/events/habits/goals/notes/panels local),
 * guardian↔student links (notes/plans/goals/chat/exams/share), sync & shared.
 * Link writes publish to *both* sides so guardian ↔ student see edits in ~1s.
 *
 * Falls back gracefully: if NEON_REALTIME_SECRET is missing, token endpoint
 * returns { realtime: false } and client uses cookie poll.
 * Vercel Hobby has no durable WebSocket, so SSE + short-poll is the portable
 * real-time primitive. Neon LISTEN works inside the serverless driver when
 * DATABASE_URL supports websockets.
 */

import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import type { AuthStore } from './authStore.js';
import { readSessionToken } from './authApi.js';
import { hashToken } from './authStore.js';
import { API_SECURITY_HEADERS } from './security.js';

const REALTIME_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS planner_realtime_events (
  id         text PRIMARY KEY,
  user_id    text NOT NULL,
  kind       text NOT NULL,
  payload    jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS planner_realtime_events_user_created_idx ON planner_realtime_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS planner_realtime_events_created_idx ON planner_realtime_events (created_at);
`.trim();

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...API_SECURITY_HEADERS },
  });
}

function getRealtimeSecret(env: Record<string, string | undefined>): string | null {
  return env.NEON_REALTIME_SECRET?.trim() || env.REALTIME_SECRET?.trim() || null;
}

// ---- JWT helpers (HS256, minimal, no deps) ----
function b64url(input: Buffer | string): string {
  const b = typeof input === 'string' ? Buffer.from(input) : input;
  return b.toString('base64url');
}
function signJwt(payload: Record<string, unknown>, secret: string, expSec: number): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + expSec }));
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}
function verifyJwt(token: string, secret: string): Record<string, unknown> | null {
  const parts = token.trim().split('.');
  if (parts.length !== 3) return null;
  const [h, b, sig] = parts;
  const expect = createHmac('sha256', secret).update(`${h}.${b}`).digest('base64url');
  const a = Buffer.from(sig);
  const c = Buffer.from(expect);
  if (a.length !== c.length || !timingSafeEqual(a, c)) return null;
  try {
    const payload = JSON.parse(Buffer.from(b, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

export function createRealtimeToken(userId: string, secret: string): string {
  return signJwt({ sub: userId, iat: Math.floor(Date.now() / 1000) }, secret, 120);
}

async function resolveUserId(request: Request, storePromise: Promise<AuthStore | null>, secret: string | null): Promise<string | null> {
  // 1) Bearer JWT (header or ?token= for EventSource which can't set headers)
  const url = new URL(request.url, 'https://planner.invalid');
  const qsToken = url.searchParams.get('token')?.trim() || '';
  const auth = request.headers.get('authorization')?.trim() ?? '';
  const bearer = /^Bearer\s+(.+)$/i.exec(auth)?.[1] ?? qsToken;
  if (bearer && secret) {
    const payload = verifyJwt(bearer.trim(), secret);
    if (payload && typeof payload.sub === 'string') return payload.sub;
  }
  // 2) Session cookie fallback
  const token = readSessionToken(request);
  if (!token) return null;
  const store = await storePromise;
  if (!store) return null;
  const found = await store.findSession(hashToken(token)).catch(() => null);
  return found?.user.id ?? null;
}

// ---- Event store helpers ----
let ensured: Promise<void> | null = null;
async function ensureRealtimeTable(databaseUrl: string): Promise<void> {
  if (ensured) return ensured;
  ensured = (async () => {
    const { Pool } = await import('@neondatabase/serverless');
    const pool = new Pool({ connectionString: databaseUrl });
    try { await pool.query(REALTIME_SCHEMA_SQL); } finally { await pool.end().catch(() => {}); }
  })().catch((e) => { ensured = null; throw e; });
  return ensured;
}

export async function publishRealtimeEvent(databaseUrl: string | undefined, userId: string, kind: string, payload: Record<string, unknown> = {}): Promise<void> {
  if (!databaseUrl) return;
  try {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(databaseUrl);
    await ensureRealtimeTable(databaseUrl);
    const id = randomBytes(12).toString('hex');
    await sql`INSERT INTO planner_realtime_events (id, user_id, kind, payload) VALUES (${id}, ${userId}, ${kind}, ${JSON.stringify(payload)}::jsonb)`;
    // Best-effort prune: keep 1h
    await sql`DELETE FROM planner_realtime_events WHERE created_at < now() - interval '1 hour'`.catch(() => {});
    // pg_notify for any long-lived listener (Neon websockets)
    await sql`SELECT pg_notify('planner_user_' || ${userId}, ${kind})`.catch(() => {});
  } catch { /* non-fatal */ }
}

/** Publish to every participant of a link (guardian + student) so both see the edit live. */
export async function publishRealtimeForLink(databaseUrl: string | undefined, linkId: string, kind: string, payload: Record<string, unknown> = {}): Promise<void> {
  if (!databaseUrl || !linkId) return;
  try {
    const { Pool } = await import('@neondatabase/serverless');
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await ensureRealtimeTable(databaseUrl);
      const res = await pool.query('SELECT guardian_id, student_id FROM planner_links WHERE id = $1', [linkId]);
      const row = res.rows[0] as { guardian_id?: string; student_id?: string | null } | undefined;
      const ids = [row?.guardian_id, row?.student_id].filter(Boolean) as string[];
      for (const uid of ids) {
        await publishRealtimeEvent(databaseUrl, uid, kind, { linkId, ...payload });
      }
    } finally { await pool.end().catch(() => {}); }
  } catch { /* non-fatal */ }
}

/** Publish to the peer(s) of a link from the actor's side — used right after a PUT. */
export async function publishLinkChange(databaseUrl: string | undefined, actorUserId: string, linkId: string, kind = 'link:updated'): Promise<void> {
  if (!databaseUrl) return;
  // Actor already gets vault:updated separately; notify the other side fast
  await publishRealtimeForLink(databaseUrl, linkId, kind, { actor: actorUserId });
}

export async function listRealtimeEvents(databaseUrl: string | undefined, userId: string, since: string | null): Promise<Array<{ id: string; kind: string; payload: unknown; created_at: string }>> {
  if (!databaseUrl) return [];
  try {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(databaseUrl);
    await ensureRealtimeTable(databaseUrl);
    const sinceDate = since ? new Date(since) : new Date(Date.now() - 5 * 60 * 1000);
    const cutoff = Number.isNaN(sinceDate.getTime()) ? new Date(Date.now() - 5 * 60 * 1000) : sinceDate;
    const rows = await sql`SELECT id, kind, payload, created_at FROM planner_realtime_events WHERE user_id = ${userId} AND created_at > ${cutoff.toISOString()}::timestamptz ORDER BY created_at ASC LIMIT 50` as Array<{ id: string; kind: string; payload: unknown; created_at: string }>;
    return rows;
  } catch { return []; }
}

// ---- HTTP handlers ----
export async function handleRealtimeToken(request: Request, store: AuthStore | null, env: Record<string, string | undefined>): Promise<Response> {
  if (request.method !== 'POST' && request.method !== 'GET') return json(405, { error: { message: 'Method not allowed' } });
  if (!store) return json(503, { error: { message: 'Database not configured' } });
  const secret = getRealtimeSecret(env);
  if (!secret) {
    // Graceful fallback: realtime via session polling, no JWT needed
    const token = readSessionToken(request);
    if (!token) return json(401, { error: { message: 'Sign in first' } });
    const found = await store.findSession(hashToken(token)).catch(() => null);
    if (!found) return json(401, { error: { message: 'Session expired' } });
    return json(200, { realtime: false, reason: 'NEON_REALTIME_SECRET not set — using cookie poll', userId: found.user.id });
  }
  const token = readSessionToken(request);
  if (!token) return json(401, { error: { message: 'Sign in first' } });
  const found = await store.findSession(hashToken(token)).catch(() => null);
  if (!found) return json(401, { error: { message: 'Session expired' } });
  const jwt = createRealtimeToken(found.user.id, secret);
  return json(200, { realtime: true, token: jwt, userId: found.user.id, expiresIn: 120 });
}

export async function handleRealtimeLinkEvent(request: Request, storePromise: Promise<AuthStore | null>, env: Record<string, string | undefined>): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: { message: 'Method not allowed' } });
  const secret = getRealtimeSecret(env);
  const userId = await resolveUserId(request, storePromise, secret);
  if (!userId) return json(401, { error: { message: 'Unauthenticated for realtime' } });
  const dbUrl = env.DATABASE_URL || env.POSTGRES_URL || env.NEON_DATABASE_URL;
  if (!dbUrl) return json(503, { error: { message: 'No database' } });
  let body: { linkId?: string; kind?: string; payload?: Record<string, unknown> };
  try { body = (await request.json()) as typeof body; } catch { return json(400, { error: { message: 'Expected JSON { linkId, kind, payload }' } }); }
  const linkId = String(body.linkId ?? '').trim();
  const kind = String(body.kind ?? '').trim().toLowerCase();
  const allowed = new Set(['typing', 'presence', 'read', 'heartbeat']);
  if (!linkId || !allowed.has(kind)) return json(400, { error: { message: 'Expected linkId and kind typing|presence|read|heartbeat' } });
  // Verify actor is participant of this link
  try {
    const { Pool } = await import('@neondatabase/serverless');
    const pool = new Pool({ connectionString: dbUrl });
    try {
      const r = await pool.query('SELECT 1 FROM planner_links WHERE id = $1 AND (guardian_id = $2 OR student_id = $2)', [linkId, userId]);
      if (r.rowCount === 0) return json(403, { error: { message: 'Not a participant of that link' } });
    } finally { await pool.end().catch(() => {}); }
  } catch { return json(502, { error: { message: 'Database unavailable' } }); }
  const payload = { ...(body.payload ?? {}), from: userId, at: new Date().toISOString() };
  const eventKind = `link:${kind}` as const;
  await publishRealtimeForLink(dbUrl, linkId, eventKind, payload);
  return json(200, { ok: true });
}

export async function handleRealtimeEvents(request: Request, storePromise: Promise<AuthStore | null>, env: Record<string, string | undefined>): Promise<Response> {
  if (request.method !== 'GET') return json(405, { error: { message: 'Method not allowed' } });
  const url = new URL(request.url, 'https://planner.invalid');
  const since = url.searchParams.get('since');
  const secret = getRealtimeSecret(env);
  const userId = await resolveUserId(request, storePromise, secret);
  if (!userId) return json(401, { error: { message: 'Unauthenticated for realtime' } });
  const dbUrl = env.DATABASE_URL || env.POSTGRES_URL || env.NEON_DATABASE_URL;
  const events = await listRealtimeEvents(dbUrl, userId, since);
  return json(200, { events, serverTime: new Date().toISOString() });
}

export async function handleRealtimeStream(request: Request, storePromise: Promise<AuthStore | null>, env: Record<string, string | undefined>): Promise<Response> {
  // SSE: holds ~25s, flushes events as they appear (Vercel max ~30s). Client reconnects.
  const secret = getRealtimeSecret(env);
  const userId = await resolveUserId(request, storePromise, secret);
  if (!userId) return json(401, { error: { message: 'Unauthenticated for realtime' } });
  const dbUrl = env.DATABASE_URL || env.POSTGRES_URL || env.NEON_DATABASE_URL;
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => {
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      send('hello', { userId, serverTime: new Date().toISOString() });
      let last = new Date(Date.now() - 10_000).toISOString();
      let ticks = 0;
      const iv = setInterval(async () => {
        ticks += 1;
        if (ticks > 12) { clearInterval(iv); try { controller.close(); } catch {} return; }
        const events = await listRealtimeEvents(dbUrl, userId, last);
        if (events.length) {
          last = events[events.length - 1]!.created_at;
          for (const e of events) send(e.kind, e);
        } else {
          send('heartbeat', { t: new Date().toISOString() });
        }
      }, 2000);
      // @ts-ignore — allow abort
      request.signal?.addEventListener?.('abort', () => { clearInterval(iv); try { controller.close(); } catch {} });
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      ...API_SECURITY_HEADERS,
    },
  });
}
