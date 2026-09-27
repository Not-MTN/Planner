// Vercel Function: GET /api/sync/status → {"configured": boolean}
import { handleSyncStatus } from '../../src/server/sync.js';

export function GET(request: Request): Response {
  return handleSyncStatus(request, process.env.DATABASE_URL);
}
