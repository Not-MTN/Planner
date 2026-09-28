// Vercel Function: POST /api/auth/salt — the KDF salt for an identifier (decoy if unknown).
import { handleSalt, resolveAuthStore } from '../../src/server/authApi.js';

export async function POST(request: Request): Promise<Response> {
  return handleSalt(request, await resolveAuthStore(process.env.DATABASE_URL));
}
