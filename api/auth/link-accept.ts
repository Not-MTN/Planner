// Vercel Function: POST /api/auth/link-accept — a student redeems a guardian's code.
import { handleLinkAccept, resolveAuthStore } from '../../src/server/authApi.js';

export async function POST(request: Request): Promise<Response> {
  return handleLinkAccept(request, await resolveAuthStore(process.env.DATABASE_URL));
}
