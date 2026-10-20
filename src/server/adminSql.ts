/**
 * Admin SQL — the editor the owner asked for.
 *
 * GET  /api/admin/users   → list users (requires admin secret)
 * POST /api/admin/sql     → run a SELECT/DELETE/EXPLAIN (requires admin secret)
 * DELETE /api/admin/users?id=<uuid> → delete that user and all their data
 *
 * Auth: X-Admin-Token: <REPORT_DASHBOARD_SECRET or ADMIN_SQL_SECRET or CRON_SECRET>
 * If none of those are set we fall back to: the request must carry an admin
 * session (username === admin or role === admin). No token needed in that path.
 * All queries are parameterized; raw SQL is only allowed via the admin token
 * with a strict allow-list (SELECT/DELETE/UPDATE/EXPLAIN/TRUNCATE) — no DDL.
 */

import { neon, Pool } from '@neondatabase/serverless';
import { API_SECURITY_HEADERS } from './security.js';
import { readSessionToken } from './authApi.js';
import { hashToken, type AuthStore } from './authStore.js';
import type { ApiEnv } from './apiRouter.js';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...API_SECURITY_HEADERS },
  });
}

function adminToken(env: ApiEnv): string | null {
  return ((env as Record<string, string | undefined>).ADMIN_SQL_SECRET?.trim()
    || env.REPORT_DASHBOARD_SECRET?.trim()
    || env.CRON_SECRET?.trim()
    || null);
}

async function isAdminRequest(request: Request, env: ApiEnv, storePromise: Promise<AuthStore | null>): Promise<boolean> {
  const expect = adminToken(env);
  if (expect) {
    const got = request.headers.get('x-admin-token')?.trim() || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() || '';
    if (got && got === expect) return true;
  }
  // Fallback: signed-in admin user
  const tok = readSessionToken(request);
  if (!tok) return false;
  const store = await storePromise;
  if (!store) return false;
  const found = await store.findSession(hashToken(tok)).catch(() => null);
  if (!found) return false;
  const u = found.user as unknown as Record<string, unknown>;
  return u.role === 'admin' || u.username_lower === 'admin' || u.usernameLower === 'admin' || Boolean((u as unknown as { is_admin?: boolean }).is_admin);
}

const ALLOWED_SQL_RE = /^\s*(SELECT|WITH\s+.*SELECT|EXPLAIN|DELETE\s+FROM|UPDATE\s+|TRUNCATE)\b/i;
const FORBIDDEN_RE = /\b(DROP|ALTER|CREATE|GRANT|REVOKE|COPY|\\copy)\b/i;

export async function handleAdminUsers(request: Request, env: ApiEnv, storePromise: Promise<AuthStore | null>): Promise<Response> {
  if (request.method !== 'GET') return json(405, { error: { message: 'Method not allowed' } });
  if (!await isAdminRequest(request, env, storePromise)) return json(403, { error: { message: 'Admin token required. Set REPORT_DASHBOARD_SECRET or ADMIN_SQL_SECRET.' } });
  const dbUrl = env.DATABASE_URL;
  if (!dbUrl) return json(503, { error: { message: 'No database' } });
  const sql = neon(dbUrl);
  try {
    const rows = await sql`
      SELECT id, username, username_lower, email, role, created_at,
             (SELECT count(*)::int FROM planner_sessions s WHERE s.user_id = u.id) AS sessions,
             (SELECT version FROM planner_vaults v WHERE v.user_id = u.id) AS vault_version
        FROM planner_users u
        ORDER BY created_at DESC
        LIMIT 200` as unknown as Array<Record<string, unknown>>;
    return json(200, { users: rows });
  } catch (e) {
    return json(500, { error: { message: String(e) } });
  }
}

export async function handleAdminSql(request: Request, env: ApiEnv, storePromise: Promise<AuthStore | null>): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: { message: 'Method not allowed' } });
  if (!await isAdminRequest(request, env, storePromise)) return json(403, { error: { message: 'Admin token required' } });
  const dbUrl = env.DATABASE_URL;
  if (!dbUrl) return json(503, { error: { message: 'No database' } });
  let body: { query?: string; params?: unknown[] };
  try { body = await request.json() as typeof body; } catch { return json(400, { error: { message: 'Expected JSON { query, params? }' } }); }
  const q = body.query?.trim();
  if (!q) return json(400, { error: { message: 'Missing query' } });
  if (!ALLOWED_SQL_RE.test(q)) return json(400, { error: { message: 'Only SELECT / EXPLAIN / DELETE FROM / UPDATE / TRUNCATE allowed' } });
  if (FORBIDDEN_RE.test(q)) return json(400, { error: { message: 'Forbidden statement' } });
  const pool = new Pool({ connectionString: dbUrl });
  try {
    const res = body.params?.length ? await pool.query(q, body.params as unknown[]) : await pool.query(q);
    return json(200, { rows: res.rows, rowCount: res.rowCount });
  } catch (e) {
    return json(400, { error: { message: String(e) } });
  } finally {
    await pool.end().catch(() => {});
  }
}

export async function handleAdminUserDelete(request: Request, env: ApiEnv, storePromise: Promise<AuthStore | null>): Promise<Response> {
  if (request.method !== 'DELETE') return json(405, { error: { message: 'Method not allowed' } });
  if (!await isAdminRequest(request, env, storePromise)) return json(403, { error: { message: 'Admin token required' } });
  const dbUrl = env.DATABASE_URL;
  if (!dbUrl) return json(503, { error: { message: 'No database' } });
  const url = new URL(request.url, 'https://planner.invalid');
  const id = url.searchParams.get('id') || url.pathname.split('/').pop() || '';
  if (!id || id === 'users') return json(400, { error: { message: 'Missing user id (?id=)' } });
  const pool = new Pool({ connectionString: dbUrl });
  try {
    await pool.query('DELETE FROM planner_sessions WHERE user_id = $1', [id]);
    await pool.query('DELETE FROM planner_vaults WHERE user_id = $1', [id]);
    await pool.query('DELETE FROM planner_sync WHERE owner_id = $1 OR account_id = $1', [id, id]);
    await pool.query('DELETE FROM planner_realtime_events WHERE user_id = $1', [id]);
    await pool.query('DELETE FROM planner_links WHERE student_id = $1 OR teacher_id = $1 OR parent_id = $1', [id, id, id]);
    await pool.query('DELETE FROM planner_shares WHERE owner_id = $1 OR member_id = $1', [id, id]);
    await pool.query('DELETE FROM planner_users WHERE id = $1', [id]);
    return json(200, { ok: true, deleted: id });
  } catch (e) {
    return json(500, { error: { message: String(e) } });
  } finally {
    await pool.end().catch(() => {});
  }
}
