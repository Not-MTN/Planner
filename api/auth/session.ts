// Vercel Function: GET /api/auth/session — who am I, if anyone?
import { handleSession, resolveAuthStore } from '../../src/server/authApi.js';

export async function GET(request: Request): Promise<Response> {
  return handleSession(request, await resolveAuthStore(process.env.DATABASE_URL));
}
