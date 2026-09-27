// Vercel Function: POST /api/xai/chat/completions → proxied to xAI with the server-side key.
// Discovered automatically from the `api/` directory; the file path is the route.
// The `.js` extension is required: Vercel compiles each TypeScript file to native
// ESM ("type": "module"), and Node ESM does not resolve extensionless imports.
import { handleXAIChatCompletions } from '../../../src/server/xaiProxy.js';

export function POST(request: Request): Promise<Response> {
  return handleXAIChatCompletions(request, process.env.XAI_API_KEY);
}
