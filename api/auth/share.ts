// Vercel Function: /api/auth/share — weekly results, encrypted end to end.
import { handleShare, resolveAuthStore } from '../../src/server/authApi.js';

async function handle(request: Request): Promise<Response> {
  return handleShare(request, await resolveAuthStore(process.env.DATABASE_URL));
}

export const GET = handle;
export const PUT = handle;
