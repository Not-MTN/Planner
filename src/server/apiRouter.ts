/**
 * Single-entry router for the whole `/api/*` surface.
 *
 * Production serves it through ONE Vercel Function via the catch-all
 * `api/[...path].ts`: Vercel's Hobby plan allows at most 12 Serverless
 * Functions per Deployment, and the API has 18 routes. The Vite dev/preview
 * middleware mounts the same `handleApiRequest`, so local development and
 * production share one code path for routing as well.
 *
 * Every handler validates the HTTP method itself (405) and the same-origin
 * policy (403), so the router only maps pathname → handler and answers 404
 * for unknown paths. Route URLs and behavior are unchanged from the days of
 * one file per route.
 */

import { Buffer } from 'node:buffer';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { API_SECURITY_HEADERS } from './security.js';
import { redactDatabaseError } from './authStore.js';
import {
  handleAccountDelete,
  handleAccountVault,
  handleAuthStatus,
  handleLinkAccept,
  handleLinks,
  handleLogin,
  handleLogout,
  handleNote,
  handlePasskeyDelete,
  handlePasskeyList,
  handlePasskeyLoginOptions,
  handlePasskeyLoginVerify,
  handlePasskeyRegisterOptions,
  handlePasskeyRegisterVerify,
  handleRecoveryComplete,
  handleRecoveryStart,
  handleRecoveryUpdate,
  handleSalt,
  handleSession,
  handleShare,
  handleSignup,
} from './authApi.js';
import { authStore } from './authStore.js';
import { handleReport } from './reportApi.js';
import { resolveProviders } from './aiProviders.js';
import { handleICS } from './icsProxy.js';
import { handleSync, handleSyncStatus, neonStore } from './sync.js';
import { handleGroqChatCompletions, handleGroqStatus } from './groqProxy.js';
import { handlePushConfig, handlePushDispatch, handlePushSubscription } from './pushApi.js';

/** The server-side environment the API reads; never exposed to the browser. */
export interface ApiEnv {
  DATABASE_URL?: string;
  GROQ_API_KEY?: string;
  GROQ_MODEL?: string;
  GROQ_VISION_MODEL?: string;
  /** Optional: forwards each crash report somewhere you actually read. */
  ERROR_REPORT_WEBHOOK?: string;
  /**
   * Every AI provider variable, passed through as read. The proxy resolves
   * providers from this rather than from a fixed list, so adding a key means
   * setting an environment variable and nothing else.
   */
  AI_ENV?: Record<string, string | undefined>;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  CRON_SECRET?: string;
}

type Handler = (request: Request) => Response | Promise<Response>;

/**
 * The AI variables the proxy resolves providers from.
 *
 * The typed `env` fields win where they are set, because a `.env.local` value
 * read by the Vite dev server never reaches `process.env`.
 */
function aiEnv(env: ApiEnv): Record<string, string | undefined> {
  const merged: Record<string, string | undefined> = { ...(env.AI_ENV ?? {}) };
  for (const key of ['GROQ_API_KEY', 'GROQ_MODEL', 'GROQ_VISION_MODEL'] as const) {
    const value = env[key];
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}

/** The one 404 every unrouted /api path gets, in dev and in production alike. */
export function notFoundResponse(): Response {
  return new Response(JSON.stringify({ error: { message: 'Not found.' } }), {
    status: 404,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...API_SECURITY_HEADERS,
    },
  });
}

/**
 * Map an `/api/...` pathname to its handler. The table mirrors the routes that
 * used to live one-file-per-route under `api/`; any other pathname is null.
 */
export function apiRoute(pathname: string, env: ApiEnv): Handler | null {
  switch (pathname) {
    case '/api/auth/account':
      return (request) => authStore(env.DATABASE_URL).then((store) => handleAccountDelete(request, store));
    case '/api/auth/link-accept':
      return (request) => authStore(env.DATABASE_URL).then((store) => handleLinkAccept(request, store));
    case '/api/auth/links':
      return (request) => authStore(env.DATABASE_URL).then((store) => handleLinks(request, store));
    case '/api/auth/login':
      return (request) => authStore(env.DATABASE_URL).then((store) => handleLogin(request, store));
    case '/api/auth/logout':
      return (request) => authStore(env.DATABASE_URL).then((store) => handleLogout(request, store));
    case '/api/auth/passkey/register/options':
      return (request) => authStore(env.DATABASE_URL).then((store) => handlePasskeyRegisterOptions(request, store));
    case '/api/auth/passkey/register/verify':
      return (request) => authStore(env.DATABASE_URL).then((store) => handlePasskeyRegisterVerify(request, store));
    case '/api/auth/passkey/login/options':
      return (request) => authStore(env.DATABASE_URL).then((store) => handlePasskeyLoginOptions(request, store));
    case '/api/auth/passkey/login/verify':
      return (request) => authStore(env.DATABASE_URL).then((store) => handlePasskeyLoginVerify(request, store));
    case '/api/auth/passkey/delete':
      return (request) => authStore(env.DATABASE_URL).then((store) => handlePasskeyDelete(request, store));
    case '/api/auth/passkey/list':
      return (request) => authStore(env.DATABASE_URL).then((store) => handlePasskeyList(request, store));
    case '/api/auth/note':
      return (request) => authStore(env.DATABASE_URL).then((store) => handleNote(request, store));
    case '/api/auth/recovery/start':
      return (request) => authStore(env.DATABASE_URL).then((store) => handleRecoveryStart(request, store));
    case '/api/auth/recovery/complete':
      return (request) => authStore(env.DATABASE_URL).then((store) => handleRecoveryComplete(request, store));
    case '/api/auth/recovery/update':
      return (request) => authStore(env.DATABASE_URL).then((store) => handleRecoveryUpdate(request, store));
    case '/api/auth/salt':
      return (request) => authStore(env.DATABASE_URL).then((store) => handleSalt(request, store));
    case '/api/auth/session':
      return (request) => authStore(env.DATABASE_URL).then((store) => handleSession(request, store));
    case '/api/auth/share':
      return (request) => authStore(env.DATABASE_URL).then((store) => handleShare(request, store));
    case '/api/auth/signup':
      return (request) => authStore(env.DATABASE_URL).then((store) => handleSignup(request, store));
    case '/api/auth/status':
      return (request) => handleAuthStatus(request, env.DATABASE_URL);
    case '/api/auth/vault':
      return (request) => authStore(env.DATABASE_URL).then((store) => handleAccountVault(request, store));
    case '/api/ics':
      return (request) => handleICS(request);
    case '/api/sync':
      return (request) => neonStore(env.DATABASE_URL).then((store) => handleSync(request, store));
    case '/api/sync/status':
      return (request) => handleSyncStatus(request, env.DATABASE_URL);
    case '/api/ai/chat/completions':
    case '/api/groq/chat/completions':
      return (request) => handleGroqChatCompletions(request, env.GROQ_API_KEY, { env: aiEnv(env) });
    case '/api/ai/status':
    case '/api/groq/status':
      return (request) => handleGroqStatus(request, env.GROQ_API_KEY, resolveProviders(aiEnv(env)));
    case '/api/push/config':
      return (request) => handlePushConfig(request, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, env.DATABASE_URL, env.CRON_SECRET);
    case '/api/push/subscription':
      return (request) => handlePushSubscription(request, env);
    case '/api/push/dispatch':
      return (request) => handlePushDispatch(request, env);
    case '/api/report':
      return (request) => handleReport(request, env.ERROR_REPORT_WEBHOOK);
    default:
      return null;
  }
}

/**
 * Normalize a request URL into a canonical `/api/...` pathname.
 *
 * Handles both direct `/api/<route>` URLs and Vercel catch-all rewritten URLs
 * such as `/api/[...path]?...path=auth/signup` or `/api/[...path]?path=auth&path=signup`.
 */
export function resolveApiPathname(url: URL): string {
  const trimmed = url.pathname.replace(/\/+$/, '') || '/';
  if (trimmed === '/api/[...path]' || trimmed === '/api') {
    const rawParts = [
      ...url.searchParams.getAll('...path'),
      ...url.searchParams.getAll('path'),
    ];
    const joined = rawParts
      .flatMap((part) => part.split('/'))
      .map((segment) => segment.trim())
      .filter(Boolean)
      .join('/');
    return joined ? `/api/${joined}` : '/api';
  }
  return trimmed;
}

/** Route one request to its handler. This is the whole server-side surface. */
export async function handleApiRequest(request: Request, env: ApiEnv): Promise<Response> {
  const url = new URL(request.url, 'https://planner.invalid');
  const pathname = resolveApiPathname(url);
  const handler = apiRoute(pathname, env);
  if (!handler) return notFoundResponse();
  try {
    return await handler(request);
  } catch (caught) {
    // Last resort: a crashed handler must never reach the client as the
    // platform's non-JSON 500 — the app can only classify JSON errors, so it
    // would show an opaque "unexpected response". Log the real cause for the
    // Vercel function logs (secrets redacted) and answer in our own envelope.
    console.error(`[planner] ${request.method} ${pathname} failed: ${redactDatabaseError(caught)}`);
    return new Response(
      JSON.stringify({ error: { message: 'Something went wrong on the server. The error has been logged — please try again.', code: 'internal_error' } }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          ...API_SECURITY_HEADERS,
        },
      },
    );
  }
}

/** Check whether the runtime passed a standard Web Fetch `Request` vs Node's `IncomingMessage`. */
export function isWebRequest(input: unknown): input is Request {
  return Boolean(
    input &&
      typeof input === 'object' &&
      typeof (input as Request).headers?.get === 'function' &&
      typeof (input as Request).text === 'function',
  );
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return undefined;
  const first = raw.split(',')[0]?.trim();
  return first || undefined;
}

/**
 * Stream a Node `IncomingMessage` body into a Web `ReadableStream`.
 *
 * Uses `req.on('data')` / `req.on('end')` rather than `Readable.toWeb(req)`
 * because `@vercel/node`'s `addHelpers` pre-reads `req` and monkey-patches
 * `req.on` via `restoreBody(req, buf)`, whereas `Readable.toWeb(req)` reads the
 * already-drained underlying `IncomingMessage` stream and produces 0 bytes.
 */
function bodyStreamFromNodeRequest(req: IncomingMessage): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      let received = false;
      let finished = false;
      const closeNormally = () => {
        if (finished) return;
        finished = true;
        controller.close();
      };
      const finishFromPreDrainedBody = () => {
        if (finished) return;
        finished = true;
        if (!received) {
          try {
            const parsed = (req as IncomingMessage & { body?: unknown }).body;
            if (parsed !== undefined && parsed !== null) {
              const raw = Buffer.isBuffer(parsed)
                ? parsed
                : parsed instanceof Uint8Array
                  ? Buffer.from(parsed.buffer, parsed.byteOffset, parsed.byteLength)
                  : typeof parsed === 'string'
                    ? Buffer.from(parsed, 'utf8')
                    : Buffer.from(JSON.stringify(parsed), 'utf8');
              if (raw.byteLength > 0) {
                controller.enqueue(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
              }
            }
          } catch {
            // Ignore getter errors when `@vercel/node` defines a throwing JSON getter on empty bodies.
          }
        }
        controller.close();
      };
      req.on('data', (chunk: Buffer | string) => {
        if (finished) return;
        received = true;
        const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk);
        controller.enqueue(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
      });
      req.on('end', closeNormally);
      req.on('error', (err) => {
        if (finished) return;
        finished = true;
        controller.error(err);
      });
      if (req.readableEnded || req.complete) {
        setImmediate(() => {
          if (!received && !finished) finishFromPreDrainedBody();
        });
      }
    },
  });
}

/** Convert a Node `IncomingMessage` into a Web `Request` preserving origin, protocol, and body. */
export function nodeRequestToWebRequest(req: IncomingMessage): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers ?? {})) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (typeof value === 'string') {
      headers.set(name, value);
    }
  }

  const forwardedProto = firstHeaderValue(req.headers?.['x-forwarded-proto'])?.toLowerCase();
  const encryptedSocket = Boolean((req.socket as { encrypted?: boolean } | undefined)?.encrypted);
  const originHeader = firstHeaderValue(req.headers?.origin)?.toLowerCase();
  const proto =
    forwardedProto === 'https' || forwardedProto === 'http'
      ? forwardedProto
      : encryptedSocket
        ? 'https'
        : originHeader?.startsWith('http://')
          ? 'http'
          : 'https';

  const rawHost = firstHeaderValue(req.headers?.host);
  const forwardedHost = firstHeaderValue(req.headers?.['x-forwarded-host']);
  const isLoopbackHost = Boolean(rawHost && /^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(rawHost));
  const host = (!rawHost || isLoopbackHost) && forwardedHost ? forwardedHost : rawHost || forwardedHost || 'localhost';
  if (!headers.has('host')) headers.set('host', host);

  const method = (req.method || 'GET').toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const url = new URL(req.url || '/', `${proto}://${host}`).toString();

  return new Request(url, {
    method,
    headers,
    body: hasBody ? bodyStreamFromNodeRequest(req) : undefined,
    ...(hasBody ? { duplex: 'half' } : {}),
  } as RequestInit);
}

/** Write a Web `Response` back to a Node `ServerResponse` and end the stream. */
export async function writeWebResponseToNode(
  webResponse: Response,
  res: ServerResponse,
  method?: string,
): Promise<void> {
  res.statusCode = webResponse.status;
  const getSetCookie = (webResponse.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const setCookies = typeof getSetCookie === 'function' ? getSetCookie.call(webResponse.headers) : [];
  if (setCookies.length > 0) {
    res.setHeader('set-cookie', setCookies);
  }
  webResponse.headers.forEach((value, name) => {
    if (name.toLowerCase() === 'set-cookie' && setCookies.length > 0) return;
    res.setHeader(name, value);
  });
  if ((method || 'GET').toUpperCase() === 'HEAD' || !webResponse.body) {
    res.end();
    return;
  }
  const bytes = Buffer.from(await webResponse.arrayBuffer());
  res.end(bytes);
}

/** Serve one Node `(req, res)` invocation end-to-end — always writes to, and ends, `res`. */
export async function handleNodeApiRequest(
  request: Request | IncomingMessage,
  res: ServerResponse,
  env: ApiEnv,
): Promise<void> {
  try {
    const webRequest = isWebRequest(request) ? request : nodeRequestToWebRequest(request);
    const webResponse = await handleApiRequest(webRequest, env);
    await writeWebResponseToNode(webResponse, res, webRequest.method);
  } catch (caught) {
    const method = isWebRequest(request) ? request.method : (request.method ?? 'UNKNOWN');
    const url = request.url ?? '/api';
    console.error(`[planner] ${method} ${url} failed: ${redactDatabaseError(caught)}`);
    if (!res.headersSent) {
      res.statusCode = 500;
      for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
        res.setHeader(name, value);
      }
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
    }
    if (!res.writableEnded) {
      try {
        res.end(
          JSON.stringify({
            error: {
              message: 'Something went wrong on the server. The error has been logged — please try again.',
              code: 'internal_error',
            },
          }),
        );
      } catch {
        /* the socket is already gone; nothing left to end */
      }
    }
  }
}
