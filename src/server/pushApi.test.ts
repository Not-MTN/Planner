import { describe, expect, it } from 'vitest';
import { handlePushConfig, handlePushDispatch } from './pushApi';

const request = (path: string, headers: Record<string, string> = {}) => new Request(`https://planner.example${path}`, { headers: { Origin: 'https://planner.example', ...headers } });

describe('push API configuration and dispatch guard', () => {
  it('never publishes a push configuration as ready when deployment prerequisites are missing', async () => {
    const response = handlePushConfig(request('/api/push/config'), 'public', undefined, undefined, undefined);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ configured: false, publicKey: null });
  });

  it('requires the cron bearer secret before looking up or sending queued notifications', async () => {
    const response = await handlePushDispatch(request('/api/push/dispatch'), { CRON_SECRET: 'long-secret' });
    expect(response.status).toBe(401);
  });
});
