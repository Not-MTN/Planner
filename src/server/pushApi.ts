import { createHash } from 'node:crypto';
import { isSameOriginRequest } from './groqProxy.js';
import { API_SECURITY_HEADERS, BodyTooLargeError, rateLimitResponse, readLimitedBody } from './security.js';
import { cleanDatabaseUrl, DatabaseConfigError, redactDatabaseError } from './authStore.js';

const MAX_BODY_BYTES = 96_000;
const MAX_JOBS = 250;
const ENDPOINT_MAX = 2048;
const TIME_MAX_MS = 90 * 24 * 60 * 60 * 1000;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...API_SECURITY_HEADERS } });
}

function configured(publicKey?: string, privateKey?: string): boolean {
  return Boolean(publicKey?.trim() && privateKey?.trim());
}

function subscriptionId(endpoint: string): string {
  return createHash('sha256').update(endpoint).digest('hex');
}

async function database(databaseUrl?: string) {
  const url = cleanDatabaseUrl(databaseUrl ?? '');
  if (!url) return null;
  const { neon } = await import('@neondatabase/serverless');
  let sql;
  try { sql = neon(url); } catch (error) {
    throw new DatabaseConfigError(`DATABASE_URL is not a valid database connection string. (${redactDatabaseError(error)})`);
  }
  await sql`CREATE TABLE IF NOT EXISTS planner_push_subscriptions (
    id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{64}$'), endpoint text NOT NULL UNIQUE,
    p256dh text NOT NULL, auth text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS planner_push_jobs (
    subscription_id text NOT NULL REFERENCES planner_push_subscriptions(id) ON DELETE CASCADE,
    reminder_key text NOT NULL, send_at timestamptz NOT NULL,
    PRIMARY KEY (subscription_id, reminder_key)
  )`;
  await sql`CREATE INDEX IF NOT EXISTS planner_push_jobs_due_idx ON planner_push_jobs (send_at)`;
  return sql;
}

function validSubscription(value: unknown): value is { endpoint: string; keys: { p256dh: string; auth: string } } {
  if (!value || typeof value !== 'object') return false;
  const sub = value as Record<string, unknown>;
  const keys = sub.keys as Record<string, unknown> | undefined;
  let endpoint: URL;
  try { endpoint = new URL(String(sub.endpoint)); } catch { return false; }
  const host = endpoint.hostname.toLowerCase();
  const trustedPushHost = host === 'fcm.googleapis.com' || host.endsWith('.push.services.mozilla.com') || host.endsWith('.push.apple.com') || host.endsWith('.notify.windows.com');
  return endpoint.protocol === 'https:' && trustedPushHost && endpoint.href.length <= ENDPOINT_MAX &&
    Boolean(keys && typeof keys.p256dh === 'string' && keys.p256dh.length <= 256 && typeof keys.auth === 'string' && keys.auth.length <= 128);
}

function cleanJobs(value: unknown): Array<{ key: string; sendAt: Date }> | null {
  if (!Array.isArray(value) || value.length > MAX_JOBS) return null;
  const now = Date.now();
  const jobs: Array<{ key: string; sendAt: Date }> = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return null;
    const item = entry as Record<string, unknown>;
    if (typeof item.key !== 'string' || !/^[a-zA-Z0-9|:_-]{1,180}$/.test(item.key) || typeof item.sendAt !== 'string') return null;
    const time = Date.parse(item.sendAt);
    if (!Number.isFinite(time) || time < now - 60_000 || time > now + TIME_MAX_MS) continue;
    jobs.push({ key: item.key, sendAt: new Date(time) });
  }
  return jobs;
}

export function handlePushConfig(request: Request, publicKey?: string, privateKey?: string, databaseUrl?: string, cronSecret?: string): Response {
  if (!isSameOriginRequest(request)) return json(403, { error: { message: 'Cross-origin push requests are not allowed.' } });
  if (request.method !== 'GET') return json(405, { error: { message: 'Method not allowed.' } });
  const ready = configured(publicKey, privateKey) && Boolean(cleanDatabaseUrl(databaseUrl ?? '') && cronSecret?.trim());
  return json(200, { configured: ready, publicKey: configured(publicKey, privateKey) ? publicKey?.trim() : null });
}

export async function handlePushSubscription(request: Request, env: { DATABASE_URL?: string; VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string }): Promise<Response> {
  if (!isSameOriginRequest(request)) return json(403, { error: { message: 'Cross-origin push requests are not allowed.' } });
  if (request.method !== 'POST' && request.method !== 'DELETE') return json(405, { error: { message: 'Method not allowed.' } });
  if (!configured(env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY)) return json(503, { error: { message: 'Background notifications are not configured on this server.', code: 'not_configured' } });
  const limited = rateLimitResponse(request, `push-subscription-${request.method}`, 20, 60_000);
  if (limited) return limited;
  const store = await database(env.DATABASE_URL);
  if (!store) return json(503, { error: { message: 'Background notifications need DATABASE_URL.', code: 'not_configured' } });
  let body: Record<string, unknown>;
  try { body = JSON.parse(await readLimitedBody(request, MAX_BODY_BYTES)) as Record<string, unknown>; }
  catch (error) { return json(error instanceof BodyTooLargeError ? 413 : 400, { error: { message: 'Invalid push request body.' } }); }
  if (!validSubscription(body.subscription)) return json(400, { error: { message: 'A valid browser push subscription is required.' } });
  const sub = body.subscription;
  const id = subscriptionId(sub.endpoint);
  if (request.method === 'DELETE') {
    await store`DELETE FROM planner_push_subscriptions WHERE id = ${id}`;
    return json(200, { ok: true });
  }
  const jobs = cleanJobs(body.jobs);
  if (!jobs) return json(400, { error: { message: 'The reminder schedule is invalid.' } });
  await store`INSERT INTO planner_push_subscriptions (id, endpoint, p256dh, auth, updated_at)
    VALUES (${id}, ${sub.endpoint}, ${sub.keys.p256dh}, ${sub.keys.auth}, now())
    ON CONFLICT (id) DO UPDATE SET endpoint = EXCLUDED.endpoint, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, updated_at = now()`;
  await store`DELETE FROM planner_push_jobs WHERE subscription_id = ${id}`;
  for (const job of jobs) {
    await store`INSERT INTO planner_push_jobs (subscription_id, reminder_key, send_at)
      VALUES (${id}, ${job.key}, ${job.sendAt.toISOString()}) ON CONFLICT (subscription_id, reminder_key)
      DO UPDATE SET send_at = EXCLUDED.send_at`;
  }
  return json(200, { ok: true, scheduled: jobs.length });
}

export async function handlePushDispatch(request: Request, env: { DATABASE_URL?: string; VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string; VAPID_SUBJECT?: string; CRON_SECRET?: string }): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST') return json(405, { error: { message: 'Method not allowed.' } });
  const secret = env.CRON_SECRET?.trim();
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return json(401, { error: { message: 'Unauthorized.' } });
  if (!configured(env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY) || !env.DATABASE_URL) return json(503, { error: { message: 'Push service is not configured.' } });
  const store = await database(env.DATABASE_URL);
  if (!store) return json(503, { error: { message: 'Push database is not configured.' } });
  const due = await store`SELECT j.subscription_id, j.reminder_key, s.endpoint, s.p256dh, s.auth
    FROM planner_push_jobs j JOIN planner_push_subscriptions s ON s.id = j.subscription_id
    WHERE j.send_at <= now() ORDER BY j.send_at LIMIT 200` as Array<{ subscription_id: string; reminder_key: string; endpoint: string; p256dh: string; auth: string }>;
  const { default: webpush } = await import('web-push');
  const publicKey = env.VAPID_PUBLIC_KEY ?? '';
  const privateKey = env.VAPID_PRIVATE_KEY ?? '';
  webpush.setVapidDetails(env.VAPID_SUBJECT?.trim() || 'mailto:planner@example.invalid', publicKey.trim(), privateKey.trim());
  let sent = 0;
  let removed = 0;
  for (const row of due) {
    try {
      await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, JSON.stringify({ title: 'Planner reminder', body: 'A reminder is due. Open Planner to see your schedule.', url: '/#/today', tag: row.reminder_key }), { TTL: 3600 });
      sent += 1;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await store`DELETE FROM planner_push_subscriptions WHERE id = ${row.subscription_id}`;
        removed += 1;
        continue;
      }
      console.error(`[planner] push delivery failed (${status ?? 'unknown'}): ${redactDatabaseError(error)}`);
    }
    await store`DELETE FROM planner_push_jobs WHERE subscription_id = ${row.subscription_id} AND reminder_key = ${row.reminder_key}`;
  }
  return json(200, { ok: true, sent, removed });
}
