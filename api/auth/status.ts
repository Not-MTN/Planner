// Vercel Function: GET /api/auth/status — {"configured": boolean} for accounts.
import { handleAuthStatus } from '../../src/server/authApi.js';

export function GET(request: Request): Response {
  return handleAuthStatus(request, process.env.DATABASE_URL);
}
