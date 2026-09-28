// Vercel Function: /api/auth/links — a guardian's requests and a student's invitations.
import { handleLinks, resolveAuthStore } from '../../src/server/authApi.js';

async function handle(request: Request): Promise<Response> {
  return handleLinks(request, await resolveAuthStore(process.env.DATABASE_URL));
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
