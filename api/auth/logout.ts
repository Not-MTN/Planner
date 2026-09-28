// Vercel Function: POST /api/auth/logout — end this session.
import { handleLogout, resolveAuthStore } from '../../src/server/authApi.js';

export async function POST(request: Request): Promise<Response> {
  return handleLogout(request, await resolveAuthStore(process.env.DATABASE_URL));
}
