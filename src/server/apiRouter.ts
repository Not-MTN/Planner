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

import { API_SECURITY_HEADERS } from './security.js';
import {
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
  handleSalt,
  handleSession,
  handleShare,
  handleSignup,
} from './authApi.js';
import { authStore } from './authStore.js';
import { handleICS } from './icsProxy.js';
import { handleSync, handleSyncStatus, neonStore } from './sync.js';
import { handleXAIChatCompletions, handleXAIStatus } from './xaiProxy.js';

/** The server-side environment the API reads; never exposed to the browser. */
export interface ApiEnv {
  DATABASE_URL?: string;
  XAI_API_KEY?: string;
  XAI_MODEL?: string;
}

type Handler = (request: Request) => Response | Promise<Response>;

function unknownRoute(): Response {
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
    case '/api/xai/chat/completions':
      return (request) => handleXAIChatCompletions(request, env.XAI_API_KEY, { model: env.XAI_MODEL });
    case '/api/xai/status':
      return (request) => handleXAIStatus(request, env.XAI_API_KEY);
    default:
      return null;
  }
}

/** Route one request to its handler. This is the whole server-side surface. */
export async function handleApiRequest(request: Request, env: ApiEnv): Promise<Response> {
  const { pathname } = new URL(request.url, 'https://planner.invalid');
  const handler = apiRoute(pathname, env);
  if (!handler) return unknownRoute();
  return handler(request);
}
