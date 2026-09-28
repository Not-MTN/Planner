// Vercel Function: /api/auth/note — one hop of a note between a guardian and a student.
import { handleNote, resolveAuthStore } from '../../src/server/authApi.js';

async function handle(request: Request): Promise<Response> {
  return handleNote(request, await resolveAuthStore(process.env.DATABASE_URL));
}

export const GET = handle;
export const PUT = handle;
