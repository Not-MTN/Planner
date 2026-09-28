// Vercel Function: api/[...path].ts — the single serverless function behind every /api/* route.
//
// Vercel's Hobby plan caps a Deployment at 12 Serverless Functions, and the
// API has 16 routes, so instead of one file per route the whole surface is
// routed by `src/server/apiRouter.ts`. The public route URLs are unchanged.
// The `.js` extension is required: Vercel compiles each TypeScript file to
// native ESM ("type": "module"), and Node ESM does not resolve extensionless imports.
import { handleApiRequest } from '../src/server/apiRouter.js';

export default async function handler(request: Request): Promise<Response> {
  return handleApiRequest(request, {
    DATABASE_URL: process.env.DATABASE_URL,
    XAI_API_KEY: process.env.XAI_API_KEY,
    XAI_MODEL: process.env.XAI_MODEL,
  });
}
