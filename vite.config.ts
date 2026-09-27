import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { Buffer } from 'node:buffer';
import { Readable } from 'node:stream';
import { cwd, env } from 'node:process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { NextHandleFunction } from 'connect';
import { handleXAIChatCompletions, handleXAIStatus } from './src/server/xaiProxy';

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

function xaiProxyHandler(apiKey: string | undefined): NextHandleFunction {
  return (request, response, next) => {
    // Mounted at /api/xai, so request.url is relative to that prefix.
    const pathname = (request.url ?? '').split('?')[0];
    let handler: ((webRequest: Request) => Response | Promise<Response>) | null = null;
    if (pathname === '/status') handler = (webRequest) => handleXAIStatus(webRequest, apiKey);
    else if (pathname === '/chat/completions') handler = (webRequest) => handleXAIChatCompletions(webRequest, apiKey);
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

function xaiProxy(apiKey: string | undefined): Plugin {
  const middleware = xaiProxyHandler(apiKey);
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

export default defineConfig(({ mode }) => {
  // Read the secret only inside the Vite/Node process. It is never defined into the browser bundle.
  const fileEnv = loadEnv(mode, cwd(), '');
  const apiKey = env.XAI_API_KEY || fileEnv.XAI_API_KEY;
  return {
    plugins: [react(), xaiProxy(apiKey)],
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      allowedHosts: true,
    },
    preview: {
      host: '0.0.0.0',
      port: 5173,
      allowedHosts: true,
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    },
  };
});
