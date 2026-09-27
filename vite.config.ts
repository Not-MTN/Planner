import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { Buffer } from 'node:buffer';
import { cwd, env } from 'node:process';
import type { NextHandleFunction } from 'connect';

const XAI_CHAT_COMPLETIONS = 'https://api.x.ai/v1/chat/completions';
const MAX_PROXY_BODY = 10 * 1024 * 1024;

function xaiProxyHandler(apiKey: string | undefined): NextHandleFunction {
  return (request, response, next) => {
    const origin = request.headers.origin;
    if (origin) {
      const requestHost = request.headers.host;
      let originHost = '';
      try {
        originHost = new URL(origin).host;
      } catch {
        // Treat malformed browser origins as cross-origin.
      }
      if (!requestHost || originHost !== requestHost) {
        response.statusCode = 403;
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Cache-Control', 'no-store');
        response.end(JSON.stringify({ error: { message: 'Cross-origin xAI proxy requests are not allowed.' } }));
        return;
      }
    }
    const pathname = (request.url ?? '').split('?')[0];
    if (request.method === 'GET' && pathname === '/status') {
      response.statusCode = 200;
      response.setHeader('Content-Type', 'application/json');
      response.setHeader('Cache-Control', 'no-store');
      response.end(JSON.stringify({ configured: Boolean(apiKey) }));
      return;
    }
    if (request.method !== 'POST' || pathname !== '/chat/completions') {
      next();
      return;
    }
    if (!apiKey) {
      response.statusCode = 503;
      response.setHeader('Content-Type', 'application/json');
      response.setHeader('Cache-Control', 'no-store');
      response.end(JSON.stringify({ error: { message: 'XAI_API_KEY is not configured. Add it to .env.local and restart the dev server.' } }));
      return;
    }

    void (async () => {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += part.length;
        if (size > MAX_PROXY_BODY) {
          response.statusCode = 413;
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({ error: { message: 'The image or plan is too large for one request.' } }));
          return;
        }
        chunks.push(part);
      }

      const upstream = await fetch(XAI_CHAT_COMPLETIONS, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: Buffer.concat(chunks),
        signal: AbortSignal.timeout(180_000),
      });
      response.statusCode = upstream.status;
      response.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json');
      response.setHeader('Cache-Control', 'no-store');
      response.end(await upstream.text());
    })().catch((error: unknown) => {
      if (response.headersSent) return;
      response.statusCode = 502;
      response.setHeader('Content-Type', 'application/json');
      const message = error instanceof Error && error.name === 'TimeoutError'
        ? 'The xAI request timed out. Please try again.'
        : 'Could not reach xAI. Check the server connection and try again.';
      response.end(JSON.stringify({ error: { message } }));
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
