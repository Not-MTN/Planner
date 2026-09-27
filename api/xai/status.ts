// Vercel Function: GET /api/xai/status → {"configured": boolean}
// Discovered automatically from the `api/` directory; the file path is the route.
// The `.js` extension is required: Vercel compiles each TypeScript file to native
// ESM ("type": "module"), and Node ESM does not resolve extensionless imports.
import { handleXAIStatus } from '../../src/server/xaiProxy.js';

export function GET(request: Request): Response {
  return handleXAIStatus(request, process.env.XAI_API_KEY);
}

export function HEAD(request: Request): Response {
  return handleXAIStatus(request, process.env.XAI_API_KEY);
}
