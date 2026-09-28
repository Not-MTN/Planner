// Vercel Function: GET / PUT /api/auth/vault — the caller's encrypted planner.
import { handleAccountVault, resolveAuthStore } from '../../src/server/authApi.js';

async function handle(request: Request): Promise<Response> {
  return handleAccountVault(request, await resolveAuthStore(process.env.DATABASE_URL));
}

export const GET = handle;
export const PUT = handle;
