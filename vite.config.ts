import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { Buffer } from 'node:buffer';
import { Readable } from 'node:stream';
import { cwd, env } from 'node:process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { NextHandleFunction } from 'connect';
import { handleXAIChatCompletions, handleXAIStatus } from './src/server/xaiProxy';
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
  handleSalt,
  handleSession,
  handleShare,
  handleSignup,
} from './src/server/authApi';
import { authStore } from './src/server/authStore';
import { handleICS } from './src/server/icsProxy';
import { notFoundResponse } from './src/server/apiRouter';

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

async function sendWebResponse(webResponse: Response, response: ServerResponse): Promise<void> {
  response.statusCode = webResponse.status;
  webResponse.headers.forEach((value, name) => response.setHeader(name, value));
  response.end(Buffer.from(await webResponse.arrayBuffer()));
}

function xaiProxyHandler(apiKey: string | undefined, model: string | undefined): NextHandleFunction {
  return (request, response, next) => {
    // Mounted at /api/xai, so request.url is relative to that prefix.
    const pathname = (request.url ?? '').split('?')[0];
    let handler: ((webRequest: Request) => Response | Promise<Response>) | null = null;
    if (pathname === '/status') handler = (webRequest) => handleXAIStatus(webRequest, apiKey);
    else if (pathname === '/chat/completions') {
      handler = (webRequest) => handleXAIChatCompletions(webRequest, apiKey, { model });
    }
    if (!handler) {
      next();
      return;
    }
    void Promise.resolve(handler(toWebRequest(request, `/api/xai${pathname}`)))
      .then((webResponse) => sendWebResponse(webResponse, response))
      .catch(() => {
        if (response.headersSent) return;
        response.statusCode = 500;
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ error: { message: 'The local xAI proxy failed. Please try again.' } }));
      });
  };
}

function xaiProxy(apiKey: string | undefined, model: string | undefined): Plugin {
  const middleware = xaiProxyHandler(apiKey, model);
  return {
    name: 'planner-xai-proxy',
    configureServer(server) {
      server.middlewares.use('/api/xai', middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/xai', middleware);
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
    void Promise.resolve(run(toWebRequest(request, `/api/sync${pathname}`)))
      .then((webResponse) => sendWebResponse(webResponse, response))
      .catch(() => {
        if (response.headersSent) return;
        response.statusCode = 500;
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ error: { message: 'The local sync API failed.' } }));
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
    void handleICS(toWebRequest(request, `/api${url}`))
      .then((webResponse) => sendWebResponse(webResponse, response))
      .catch(() => {
        if (response.headersSent) return;
        response.statusCode = 500;
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ error: { message: 'The local calendar proxy failed.' } }));
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
        : pathname === '/salt'
          ? (webRequest) => authStore(databaseUrl).then((store) => handleSalt(webRequest, store))
          : pathname === '/login'
            ? (webRequest) => authStore(databaseUrl).then((store) => handleLogin(webRequest, store))
            : pathname === '/session'
              ? (webRequest) => authStore(databaseUrl).then((store) => handleSession(webRequest, store))
              : pathname === '/logout'
                ? (webRequest) => authStore(databaseUrl).then((store) => handleLogout(webRequest, store))
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
                          : null;
    if (!run) {
      next();
      return;
    }
    void run(toWebRequest(request, `/api/auth${pathname}`))
      .then((webResponse) => sendWebResponse(webResponse, response))
      .catch(() => {
        if (response.headersSent) return;
        response.statusCode = 500;
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ error: { message: 'The local accounts API failed.' } }));
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

export default defineConfig(({ mode }) => {
  // Read the secret only inside the Vite/Node process. It is never defined into the browser bundle.
  const fileEnv = loadEnv(mode, cwd(), '');
  const apiKey = env.XAI_API_KEY || fileEnv.XAI_API_KEY;
  const model = env.XAI_MODEL || fileEnv.XAI_MODEL;
  const databaseUrl = env.DATABASE_URL || fileEnv.DATABASE_URL;
  return {
    plugins: [react(), xaiProxy(apiKey, model), syncApi(databaseUrl), authApi(databaseUrl), icsApi(), apiFallback()],
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
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    },
  };
});
