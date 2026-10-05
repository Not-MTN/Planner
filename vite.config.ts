import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { cwd, env } from 'node:process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { NextHandleFunction } from 'connect';
import { handleGroqChatCompletions, handleGroqStatus } from './src/server/groqProxy';
import { API_SECURITY_HEADERS } from './src/server/security';
import { handleSync, handleSyncStatus, neonStore } from './src/server/sync';
import {
  handleAccountVault,
  handleAuthStatus,
  handleLinkAccept,
  handleLinks,
  handleLogin,
  handleNote,
  handleLogout,
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
  handleSessions,
  handleAuthEvents,
  handleShare,
  handleSignup,
} from './src/server/authApi';
import { authStore } from './src/server/authStore';
import { handleICS } from './src/server/icsProxy';
import { notFoundResponse, withAppCors } from './src/server/apiRouter';
import { preflightResponse } from './src/server/appOrigins';

// API responses can use a deny-all CSP; the HTML document needs its own app CSP,
// which is configured in vercel.json. Do not put the API CSP on Vite's HTML page.
const DEV_SECURITY_HEADERS = Object.fromEntries(
  Object.entries(API_SECURITY_HEADERS).filter(([name]) => name !== 'Content-Security-Policy'),
);

/** Convert a Node request to a Web Request so dev/preview share the Vercel Function code path. */
function toWebRequest(request: IncomingMessage, pathname: string): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
    else if (value !== undefined) headers.set(name, value);
  }
  const method = request.method ?? 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD';
  return new Request(`http://${request.headers.host ?? 'localhost'}${pathname}`, {
    method,
    headers,
    body: hasBody ? (Readable.toWeb(request) as ReadableStream<Uint8Array>) : undefined,
    // Required by Node's fetch implementation for streamed request bodies.
    ...(hasBody ? { duplex: 'half' } : {}),
  } as RequestInit);
}

/**
 * A local API failure, with the same CORS answer a successful response gets.
 * Without them an installed app reads a 500 as an opaque network error and
 * tells the user it is offline, which is the wrong problem.
 */
function devApiError(message: string, webRequest: Request): Response {
  return withAppCors(
    new Response(JSON.stringify({ error: { message } }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    }),
    webRequest,
  );
}

async function sendWebResponse(webResponse: Response, response: ServerResponse): Promise<void> {
  response.statusCode = webResponse.status;
  webResponse.headers.forEach((value, name) => response.setHeader(name, value));
  response.end(Buffer.from(await webResponse.arrayBuffer()));
}

/**
 * Answer a shell's preflight the way the deployed router does.
 *
 * The other dev middlewares dispatch straight to their handlers, which is fine
 * for a browser (same origin, no preflight) but useless to an installed app:
 * it runs from `https://localhost` / `capacitor://localhost` / `app://planner`,
 * so its JSON POSTs are preflighted first. Registered before them, this answers
 * that preflight for the origins the operator named in PLANNER_APP_ORIGINS and
 * passes everything else through untouched.
 */
function appOrigins(): Plugin {
  const middleware: NextHandleFunction = (request, response, next) => {
    if (request.method !== 'OPTIONS' || !request.url?.startsWith('/api')) {
      next();
      return;
    }
    const preflight = preflightResponse(toWebRequest(request, request.url));
    if (!preflight) {
      next();
      return;
    }
    void sendWebResponse(preflight, response);
  };
  return {
    name: 'planner-app-origins',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

function groqProxyHandler(apiKey: string | undefined, model: string | undefined, visionModel: string | undefined): NextHandleFunction {
  return (request, response, next) => {
    // Mounted at /api/groq, so request.url is relative to that prefix.
    const pathname = (request.url ?? '').split('?')[0];
    let handler: ((webRequest: Request) => Response | Promise<Response>) | null = null;
    if (pathname === '/status') handler = (webRequest) => handleGroqStatus(webRequest, apiKey);
    else if (pathname === '/chat/completions') {
      handler = (webRequest) => handleGroqChatCompletions(webRequest, apiKey, { model, visionModel });
    }
    if (!handler) {
      next();
      return;
    }
    const webRequest = toWebRequest(request, `/api/groq${pathname}`);
    void Promise.resolve(handler(webRequest))
      .then((webResponse) => sendWebResponse(withAppCors(webResponse, webRequest), response))
      .catch(() => {
        if (!response.headersSent) void sendWebResponse(devApiError('The local Groq proxy failed. Please try again.', webRequest), response);
      });
  };
}

function groqProxyPlugin(apiKey: string | undefined, model: string | undefined, visionModel: string | undefined): Plugin {
  const middleware = groqProxyHandler(apiKey, model, visionModel);
  return {
    name: 'planner-groq-proxy',
    configureServer(server) {
      server.middlewares.use('/api/groq', middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/groq', middleware);
    },
  };
}

function syncHandler(databaseUrl: string | undefined): NextHandleFunction {
  return (request, response, next) => {
    const pathname = (request.url ?? '').split('?')[0];
    let run: ((webRequest: Request) => Response | Promise<Response>) | null = null;
    if (pathname === '/status') run = (webRequest) => handleSyncStatus(webRequest, databaseUrl);
    else if (pathname === '/' || pathname === '') run = async (webRequest) => handleSync(webRequest, await neonStore(databaseUrl));
    if (!run) {
      next();
      return;
    }
    const webRequest = toWebRequest(request, `/api/sync${pathname}`);
    void Promise.resolve(run(webRequest))
      .then((webResponse) => sendWebResponse(withAppCors(webResponse, webRequest), response))
      .catch(() => {
        if (!response.headersSent) void sendWebResponse(devApiError('The local sync API failed.', webRequest), response);
      });
  };
}

function syncApi(databaseUrl: string | undefined): Plugin {
  const middleware = syncHandler(databaseUrl);
  return {
    name: 'planner-sync-api',
    configureServer(server) {
      server.middlewares.use('/api/sync', middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/sync', middleware);
    },
  };
}

function icsHandler(): NextHandleFunction {
  return (request, response, next) => {
    const url = request.url ?? '';
    if (!url.startsWith('/ics')) {
      next();
      return;
    }
    const webRequest = toWebRequest(request, `/api${url}`);
    void handleICS(webRequest)
      .then((webResponse) => sendWebResponse(withAppCors(webResponse, webRequest), response))
      .catch(() => {
        if (!response.headersSent) void sendWebResponse(devApiError('The local calendar proxy failed.', webRequest), response);
      });
  };
}

function icsApi(): Plugin {
  const middleware = icsHandler();
  return {
    name: 'planner-ics-api',
    configureServer(server) {
      server.middlewares.use('/api', middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api', middleware);
    },
  };
}

function authHandler(databaseUrl: string | undefined): NextHandleFunction {
  return (request, response, next) => {
    const pathname = (request.url ?? '').split('?')[0];
    const run: ((webRequest: Request) => Promise<Response>) | null =
      pathname === '/signup'
        ? (webRequest) => authStore(databaseUrl).then((store) => handleSignup(webRequest, store))
        : pathname === '/recovery/start'
          ? (webRequest) => authStore(databaseUrl).then((store) => handleRecoveryStart(webRequest, store))
          : pathname === '/recovery/complete'
            ? (webRequest) => authStore(databaseUrl).then((store) => handleRecoveryComplete(webRequest, store))
          : pathname === '/recovery/update'
            ? (webRequest) => authStore(databaseUrl).then((store) => handleRecoveryUpdate(webRequest, store))
        : pathname === '/totp/login'
          ? (webRequest) => authStore(databaseUrl).then((store) => handleTotpLogin(webRequest, store))
        : pathname === '/totp/setup'
          ? (webRequest) => authStore(databaseUrl).then((store) => handleTotpSetup(webRequest, store))
        : pathname === '/totp/confirm'
          ? (webRequest) => authStore(databaseUrl).then((store) => handleTotpConfirm(webRequest, store))
        : pathname === '/totp/disable'
          ? (webRequest) => authStore(databaseUrl).then((store) => handleTotpDisable(webRequest, store))
        : pathname === '/salt'
          ? (webRequest) => authStore(databaseUrl).then((store) => handleSalt(webRequest, store))
          : pathname === '/login'
            ? (webRequest) => authStore(databaseUrl).then((store) => handleLogin(webRequest, store))
            : pathname === '/session'
              ? (webRequest) => authStore(databaseUrl).then((store) => handleSession(webRequest, store))
              : pathname === '/logout'
                ? (webRequest) => authStore(databaseUrl).then((store) => handleLogout(webRequest, store))
              : pathname === '/sessions'
                ? (webRequest) => authStore(databaseUrl).then((store) => handleSessions(webRequest, store))
                : pathname === '/events'
                  ? (webRequest) => authStore(databaseUrl).then((store) => handleAuthEvents(webRequest, store))
          : pathname === '/vault'
            ? (webRequest) => authStore(databaseUrl).then((store) => handleAccountVault(webRequest, store))
          : pathname === '/passkey/register/options'
            ? (webRequest) => authStore(databaseUrl).then((store) => handlePasskeyRegisterOptions(webRequest, store))
          : pathname === '/passkey/register/verify'
            ? (webRequest) => authStore(databaseUrl).then((store) => handlePasskeyRegisterVerify(webRequest, store))
          : pathname === '/passkey/login/options'
            ? (webRequest) => authStore(databaseUrl).then((store) => handlePasskeyLoginOptions(webRequest, store))
          : pathname === '/passkey/login/verify'
            ? (webRequest) => authStore(databaseUrl).then((store) => handlePasskeyLoginVerify(webRequest, store))
          : pathname === '/passkey/delete'
            ? (webRequest) => authStore(databaseUrl).then((store) => handlePasskeyDelete(webRequest, store))
          : pathname === '/passkey/list'
            ? (webRequest) => authStore(databaseUrl).then((store) => handlePasskeyList(webRequest, store))
          : pathname === '/status'
                    ? (webRequest) => Promise.resolve(handleAuthStatus(webRequest, databaseUrl))
                    : pathname === '/links'
                      ? (webRequest) => authStore(databaseUrl).then((store) => handleLinks(webRequest, store))
                      : pathname === '/link-accept'
                        ? (webRequest) => authStore(databaseUrl).then((store) => handleLinkAccept(webRequest, store))
                        : pathname === '/share'
                          ? (webRequest) => authStore(databaseUrl).then((store) => handleShare(webRequest, store))
                          : pathname === '/note'
                            ? (webRequest) => authStore(databaseUrl).then((store) => handleNote(webRequest, store))
                            : null;
    if (!run) {
      next();
      return;
    }
    const webRequest = toWebRequest(request, `/api/auth${request.url ?? pathname}`);
    void run(webRequest)
      .then((webResponse) => sendWebResponse(withAppCors(webResponse, webRequest), response))
      .catch(() => {
        if (!response.headersSent) void sendWebResponse(devApiError('The local accounts API failed.', webRequest), response);
      });
  };
}

/**
 * Dev/preview parity with the deployed catch-all function: an unknown /api path
 * answers the same JSON 404 instead of Vite's empty 404 (POST) or the HTML shell
 * (GET). A misrouted or missing API then reads the same wherever it happens.
 *
 * Registered last, so it only sees paths no earlier /api middleware claimed.
 */
function apiFallback(): Plugin {
  const middleware: NextHandleFunction = (_request, response) => {
    void sendWebResponse(notFoundResponse(), response);
  };
  return {
    name: 'planner-api-fallback',
    configureServer(server) {
      server.middlewares.use('/api', middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api', middleware);
    },
  };
}

function authApi(databaseUrl: string | undefined): Plugin {
  const middleware = authHandler(databaseUrl);
  return {
    name: 'planner-auth-api',
    configureServer(server) {
      server.middlewares.use('/api/auth', middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/auth', middleware);
    },
  };
}

function pushApi(pushEnv: { DATABASE_URL?: string; VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string; VAPID_SUBJECT?: string; CRON_SECRET?: string; FCM_SERVICE_ACCOUNT?: string; APNS_KEY_ID?: string; APNS_TEAM_ID?: string; APNS_KEY_P8?: string; APNS_BUNDLE_ID?: string }): Plugin {
  const middleware: NextHandleFunction = (request, response, next) => {
    if (!request.url?.startsWith('/push/')) { next(); return; }
    const pathname = `/api${request.url}`;
    const webRequest = toWebRequest(request, pathname);
    void import('./src/server/pushVite').then(({ handleLocalPush }) => handleLocalPush(webRequest, pushEnv))
      .then((result) => sendWebResponse(withAppCors(result, webRequest), response))
      .catch(() => { if (!response.headersSent) void sendWebResponse(devApiError('The local push API failed.', webRequest), response); });
  };
  return {
    name: 'planner-push-api',
    configureServer(server) { server.middlewares.use('/api', middleware); },
    configurePreviewServer(server) { server.middlewares.use('/api', middleware); },
  };
}

/**
 * `PLANNER_API_ORIGIN` names the API for a packaged app build. Only a bare
 * http(s) origin is accepted — a path or a wildcard would make the built app
 * talk to something other than the deployment the operator meant.
 */
function normalizeAppApiOrigin(value: string | undefined): string {
  const trimmed = (value ?? '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    if (url.pathname !== '' && url.pathname !== '/') return '';
    if (!url.hostname) return '';
    return url.origin;
  } catch {
    return '';
  }
}

export default defineConfig(({ mode }) => {
  // Read the secret only inside the Vite/Node process. It is never defined into the browser bundle.
  const fileEnv = loadEnv(mode, cwd(), '');
  // The version this build is. `PLANNER_VERSION_NAME` is what the Apps workflow
  // sets from a release tag, so an installed app and the release it came from
  // agree; otherwise the package version is the answer. src/shared/updates.ts
  // compares this with the newest published release.
  const appVersion = (env.PLANNER_VERSION_NAME || fileEnv.PLANNER_VERSION_NAME || '').trim().replace(/^v/, '')
    || JSON.parse(readFileSync(join(cwd(), 'package.json'), 'utf8')).version
    || '0.0.0';
  const apiKey = env.GROQ_API_KEY || fileEnv.GROQ_API_KEY;
  const model = env.GROQ_MODEL || fileEnv.GROQ_MODEL;
  const visionModel = env.GROQ_VISION_MODEL ?? fileEnv.GROQ_VISION_MODEL;
  const databaseUrl = env.DATABASE_URL || fileEnv.DATABASE_URL;
  // Packaged apps (Android, iOS, desktop) are a different origin from the API,
  // so their build carries the address. Empty for the website and for local
  // development, where `/api/...` stays relative.
  const apiOrigin = normalizeAppApiOrigin(env.PLANNER_API_ORIGIN || fileEnv.PLANNER_API_ORIGIN);
  // Where a link the app hands out (a guardian's invite QR, "get the apps")
  // should point. A packaged app is served from https://localhost, so it cannot
  // be its own answer; the deployment that built it is. Any of the three names
  // answers, and an explicit PLANNER_LINK_ORIGIN wins.
  const linkOrigin = normalizeAppApiOrigin(
    env.PLANNER_LINK_ORIGIN || fileEnv.PLANNER_LINK_ORIGIN || env.PLANNER_APP_URL || fileEnv.PLANNER_APP_URL || env.PLANNER_API_ORIGIN || fileEnv.PLANNER_API_ORIGIN,
  );
  // The API handlers read this one straight from `process.env`, exactly as the
  // deployed function does — so a value in `.env.local` has to be put there,
  // or a shell pointed at a local dev server would be refused as cross-origin.
  if (!env.PLANNER_APP_ORIGINS && fileEnv.PLANNER_APP_ORIGINS) {
    process.env.PLANNER_APP_ORIGINS = fileEnv.PLANNER_APP_ORIGINS;
  }
  const pushEnv = {
    DATABASE_URL: databaseUrl,
    VAPID_PUBLIC_KEY: env.VAPID_PUBLIC_KEY || fileEnv.VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: env.VAPID_PRIVATE_KEY || fileEnv.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: env.VAPID_SUBJECT || fileEnv.VAPID_SUBJECT,
    FCM_SERVICE_ACCOUNT: env.FCM_SERVICE_ACCOUNT || fileEnv.FCM_SERVICE_ACCOUNT,
    APNS_KEY_ID: env.APNS_KEY_ID || fileEnv.APNS_KEY_ID,
    APNS_TEAM_ID: env.APNS_TEAM_ID || fileEnv.APNS_TEAM_ID,
    APNS_KEY_P8: env.APNS_KEY_P8 || fileEnv.APNS_KEY_P8,
    APNS_BUNDLE_ID: env.APNS_BUNDLE_ID || fileEnv.APNS_BUNDLE_ID,
    CRON_SECRET: env.CRON_SECRET || fileEnv.CRON_SECRET,
    ERROR_REPORT_WEBHOOK: env.ERROR_REPORT_WEBHOOK || fileEnv.ERROR_REPORT_WEBHOOK,
    AI_ENV: { ...env, ...fileEnv } as Record<string, string | undefined>,
  };
  return {
    // `__PLANNER_API_ORIGIN__` is read by src/shared/nativeShell.ts. Defining it
    // (rather than a VITE_ variable) keeps the name identical in the app, in
    // this config, and in the server-side allow-list docs.
    define: {
      __PLANNER_API_ORIGIN__: JSON.stringify(apiOrigin),
      __PLANNER_LINK_ORIGIN__: JSON.stringify(linkOrigin),
      __APP_VERSION__: JSON.stringify(appVersion),
    },
    plugins: [appOrigins(), react(), groqProxyPlugin(apiKey, model, visionModel), syncApi(databaseUrl), authApi(databaseUrl), icsApi(), pushApi(pushEnv), apiFallback()],
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom'],
          },
        },
      },
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      headers: DEV_SECURITY_HEADERS,
      // Keep the Arena preview working without opening the dev server to every Host header.
      allowedHosts: ['localhost', '127.0.0.1', '0.0.0.0', '.e2b.app'],
    },
    preview: {
      host: '0.0.0.0',
      port: 5173,
      headers: DEV_SECURITY_HEADERS,
      allowedHosts: ['localhost', '127.0.0.1', '0.0.0.0', '.e2b.app'],
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'desktop/*.test.mjs', 'scripts/**/*.test.mjs'],
    },
  };
});
