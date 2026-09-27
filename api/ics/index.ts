// Vercel Function: GET /api/ics — fetch a public calendar feed through the hardened proxy.
import { handleICS } from '../../src/server/icsProxy.js';

export const GET = async (request: Request): Promise<Response> => handleICS(request);
