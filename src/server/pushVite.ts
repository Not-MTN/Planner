import { handlePushConfig, handlePushDevice, handlePushDispatch, handlePushSubscription } from './pushApi';
import type { DevicePushEnv } from './devicePush';

export interface LocalPushEnv extends DevicePushEnv {
  DATABASE_URL?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  CRON_SECRET?: string;
}

export async function handleLocalPush(request: Request, env: LocalPushEnv): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === '/api/push/config') return handlePushConfig(request, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, env.DATABASE_URL, env.CRON_SECRET, env);
  if (path === '/api/push/subscription') return handlePushSubscription(request, env);
  if (path === '/api/push/device') return handlePushDevice(request, env);
  if (path === '/api/push/dispatch') return handlePushDispatch(request, env);
  return new Response(JSON.stringify({ error: { message: 'Not found.' } }), { status: 404, headers: { 'Content-Type': 'application/json' } });
}
