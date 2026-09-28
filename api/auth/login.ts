// Vercel Function: POST /api/auth/login — verify and open a session.
import { handleLogin, resolveAuthStore } from '../../src/server/authApi.js';

export async function POST(request: Request): Promise<Response> {
  return handleLogin(request, await resolveAuthStore(process.env.DATABASE_URL));
}
