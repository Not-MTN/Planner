/**
 * Server-only sync API shared by the Vercel Functions in `api/sync/*` and the
 * Vite dev/preview middleware. Stores end-to-end encrypted planner blobs in Neon.
 *
 * The server never sees planner contents or the sync code: the browser sends a
 * SHA-256 id derived from the code and an AES-GCM ciphertext.
 */

import { isSameOriginRequest } from './xaiProxy.js';

export const MAX_SYNC_BYTES = 3_000_000;
const ID_PATTERN = /^[a-f0-9]{64}$/;

export const MISSING_DB_MESSAGE =
  'DATABASE_URL is not configured on the server. Add your Neon connection string under Vercel → Project Settings → Environment Variables (or in .env.local) and restart.';

export interface SyncRow {
  version: number;
  ciphertext: string;
  updated_at: string | Date;
}

/** Minimal storage interface so the handler can be tested without a database. */
export interface SyncStore {
  get(id: string): Promise<SyncRow | null>;
  /** Insert (baseVersion 0) or compare-and-swap update. Returns the new row, or null on a version conflict. */
  put(id: string, baseVersion: number, ciphertext: string): Promise<SyncRow | null>;
  remove(id: string): Promise<void>;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function rowBody(row: SyncRow) {
  return { version: row.version, ciphertext: row.ciphertext, updatedAt: new Date(row.updated_at).toISOString() };
}

export function handleSyncStatus(request: Request, databaseUrl: string | undefined): Response {
  if (!isSameOriginRequest(request)) return json(403, { error: { message: 'Cross-origin sync requests are not allowed.' } });
  if (request.method !== 'GET' && request.method !== 'HEAD') return json(405, { error: { message: 'Method not allowed.' } });
  return json(200, { configured: Boolean(databaseUrl?.trim()) });
}

export async function handleSync(request: Request, store: SyncStore | null): Promise<Response> {
  if (!isSameOriginRequest(request)) return json(403, { error: { message: 'Cross-origin sync requests are not allowed.' } });
  if (!store) return json(503, { error: { message: MISSING_DB_MESSAGE, code: 'not_configured' } });
  const id = request.headers.get('x-sync-id')?.trim().toLowerCase() ?? '';
  if (!ID_PATTERN.test(id)) return json(400, { error: { message: 'Missing or invalid sync id.' } });

  try {
    if (request.method === 'GET') {
      const row = await store.get(id);
      return row ? json(200, rowBody(row)) : json(404, { error: { message: 'Nothing stored for this sync code yet.', code: 'not_found' } });
    }

    if (request.method === 'DELETE') {
      await store.remove(id);
      return json(200, { ok: true });
    }

    if (request.method === 'PUT') {
      const length = Number(request.headers.get('content-length') ?? 0);
      if (length > MAX_SYNC_BYTES) return json(413, { error: { message: 'Planner data is too large to sync.' } });
      const text = await request.text();
      if (text.length > MAX_SYNC_BYTES) return json(413, { error: { message: 'Planner data is too large to sync.' } });
      let body: { baseVersion?: unknown; ciphertext?: unknown };
      try {
        body = JSON.parse(text) as typeof body;
      } catch {
        return json(400, { error: { message: 'Body must be JSON.' } });
      }
      const baseVersion = typeof body.baseVersion === 'number' && Number.isInteger(body.baseVersion) && body.baseVersion >= 0 ? body.baseVersion : -1;
      const ciphertext = typeof body.ciphertext === 'string' ? body.ciphertext : '';
      if (baseVersion < 0 || !ciphertext || !/^[A-Za-z0-9+/=]+$/.test(ciphertext)) {
        return json(400, { error: { message: 'Expected { baseVersion, ciphertext }.' } });
      }
      const row = await store.put(id, baseVersion, ciphertext);
      if (row) return json(200, rowBody(row));
      const current = await store.get(id);
      return json(409, { error: { message: 'Another device synced first.', code: 'conflict' }, current: current ? rowBody(current) : null });
    }

    return json(405, { error: { message: 'Method not allowed.' } });
  } catch {
    return json(502, { error: { message: 'The sync database could not be reached. Try again shortly.' } });
  }
}

/** Neon-backed store. Imported lazily so the dependency only loads on the server. */
export async function createNeonStore(databaseUrl: string | undefined): Promise<SyncStore | null> {
  databaseUrl = databaseUrl?.trim();
  if (!databaseUrl) return null;
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(databaseUrl);
  let ready: Promise<unknown> | null = null;
  const ensure = () => {
    ready ??= sql`CREATE TABLE IF NOT EXISTS planner_sync (
      id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{64}$'),
      version integer NOT NULL CHECK (version > 0),
      ciphertext text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`.catch((error: unknown) => {
      ready = null;
      throw error;
    });
    return ready;
  };
  return {
    async get(id) {
      await ensure();
      const rows = (await sql`SELECT version, ciphertext, updated_at FROM planner_sync WHERE id = ${id}`) as SyncRow[];
      return rows[0] ?? null;
    },
    async put(id, baseVersion, ciphertext) {
      await ensure();
      const rows = (baseVersion === 0
        ? await sql`INSERT INTO planner_sync (id, version, ciphertext) VALUES (${id}, 1, ${ciphertext})
            ON CONFLICT (id) DO NOTHING RETURNING version, ciphertext, updated_at`
        : await sql`UPDATE planner_sync SET version = version + 1, ciphertext = ${ciphertext}, updated_at = now()
            WHERE id = ${id} AND version = ${baseVersion} RETURNING version, ciphertext, updated_at`) as SyncRow[];
      return rows[0] ?? null;
    },
    async remove(id) {
      await ensure();
      await sql`DELETE FROM planner_sync WHERE id = ${id}`;
    },
  };
}

let cached: { url: string; store: Promise<SyncStore | null> } | null = null;

/** Reuses one store per warm function instance. */
export function neonStore(databaseUrl: string | undefined): Promise<SyncStore | null> {
  databaseUrl = databaseUrl?.trim();
  if (!databaseUrl) return Promise.resolve(null);
  if (!cached || cached.url !== databaseUrl) cached = { url: databaseUrl, store: createNeonStore(databaseUrl) };
  return cached.store;
}
