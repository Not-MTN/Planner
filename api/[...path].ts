// Vercel Function: api/[...path].ts — the single serverless function behind every /api/* route.
// The explicit /api/(.*) rewrite in vercel.json is important: Vercel's inferred
// catch-all routing can miss nested paths such as /api/auth/salt and return a
// platform 404 before this handler runs.
//
// Vercel's Hobby plan caps a Deployment at 12 Serverless Functions, and the
// API has 18 routes, so instead of one file per route the whole surface is
// routed by `src/server/apiRouter.ts`. The public route URLs are unchanged.
//
// `@vercel/node` invokes default-export functions with Node's
// `(req: IncomingMessage, res: ServerResponse)` signature unless Web handler
// exports are active, while unit tests invoke `handler(new Request(...))`
// directly. Supporting both signatures ensures the function never leaves
// `ServerResponse` un-ended in production.
//
// The `.js` extension is required: Vercel compiles each TypeScript file to
// native ESM ("type": "module"), and Node ESM does not resolve extensionless imports.
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  handleApiRequest,
  handleNodeApiRequest,
  isWebRequest,
  type ApiEnv,
} from '../src/server/apiRouter.js';

function currentEnv(): ApiEnv {
  return {
    DATABASE_URL:
      process.env.DATABASE_URL ||
      process.env.POSTGRES_URL ||
      process.env.NEON_DATABASE_URL,
    GROQ_API_KEY: process.env.GROQ_API_KEY,
    GROQ_MODEL: process.env.GROQ_MODEL,
    GROQ_VISION_MODEL: process.env.GROQ_VISION_MODEL,
    ERROR_REPORT_WEBHOOK: process.env.ERROR_REPORT_WEBHOOK,
    VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: process.env.VAPID_SUBJECT,
    CRON_SECRET: process.env.CRON_SECRET,
  };
}

export default async function handler(request: Request): Promise<Response>;
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void>;
export default async function handler(
  reqOrRequest: Request | IncomingMessage,
  res?: ServerResponse,
): Promise<Response | void> {
  const env = currentEnv();
  // Whenever the runtime gave us a ServerResponse, the only way out is to
  // write to it and end it — a returned Response is ignored on that path, and
  // an un-ended socket is exactly the "stuck with no error" bug.
  if (res) {
    await handleNodeApiRequest(reqOrRequest, res, env);
    return;
  }
  if (isWebRequest(reqOrRequest)) {
    return handleApiRequest(reqOrRequest, env);
  }
  throw new TypeError('Unsupported request object passed to API handler.');
}
