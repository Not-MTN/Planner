// Vercel Function: POST /api/auth/signup — create an account and its encrypted vault.
import { handleSignup, resolveAuthStore } from '../../src/server/authApi.js';

export async function POST(request: Request): Promise<Response> {
  return handleSignup(request, await resolveAuthStore(process.env.DATABASE_URL));
}
