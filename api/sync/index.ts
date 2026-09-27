// Vercel Function: GET / PUT / DELETE /api/sync — end-to-end encrypted planner sync (Neon).
import { handleSync, neonStore } from '../../src/server/sync.js';

async function handle(request: Request): Promise<Response> {
  return handleSync(request, await neonStore(process.env.DATABASE_URL));
}

export const GET = handle;
export const PUT = handle;
export const DELETE = handle;
