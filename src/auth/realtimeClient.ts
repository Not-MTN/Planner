/**
 * Neon Realtime client — live sync for EVERY part of the app.
 *
 * Vault (tasks/events/habits/goals/notes) + sync + shared + guardian↔student
 * links (notes/plans/goals/chat/exams/share) all flow through one channel:
 *   server: planner_realtime_events (per user_id, kind, payload, created_at)
 *   client: SSE /api/realtime/stream (push) → fallback poll /api/realtime/events (1.4s)
 *           authenticated by short JWT from NEON_REALTIME_SECRET or by cookie.
 *
 * On any vault:updated → pullVault → mergeStates → commit
 * On any link:*       → kickPanelSync (guardian/student pipeline)
 * On sync/shared:*    → runSync / runSharedSync
 * Ephemeral link events: typing, presence, read receipts → UI only, no DB heavy sync
 *
 * Plus BroadcastChannel for instant same-device multi-tab (no server hop).
 * Works on web + Capacitor (effectiveApiOrigin()).
 */

import { effectiveApiOrigin } from '../shared/nativeShell';
import { decryptState } from './crypto';
import { getActiveSession, pullVault } from './session';
import { mergeStates } from '../sync';
import type { PlannerState } from '../types';

export type RealtimeEvent = { id: string; kind: string; payload: unknown; created_at: string };

function apiUrl(path: string): string {
  const origin = effectiveApiOrigin()?.replace(/\/+$/, '') ?? '';
  return origin ? `${origin}${path}` : path;
}

async function authFetch(path: string, init: RequestInit & { token?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...((init.headers as Record<string, string>) ?? {}) };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  return fetch(apiUrl(path), { credentials: 'same-origin', ...init, headers });
}

let realtimeToken: string | null = null;
let tokenExpiresAt = 0;

export async function getRealtimeToken(): Promise<string | null> {
  if (realtimeToken && Date.now() < tokenExpiresAt - 10_000) return realtimeToken;
  try {
    const res = await authFetch('/api/realtime/token', { method: 'POST' });
    if (!res.ok) return null;
    const body = await res.json() as { realtime?: boolean; token?: string; expiresIn?: number };
    if (body.token) {
      realtimeToken = body.token;
      tokenExpiresAt = Date.now() + (body.expiresIn ?? 90) * 1000;
      return realtimeToken;
    }
    return null; // cookie-poll mode
  } catch { return null; }
}

export async function fetchRealtimeEvents(since: string | null, token: string | null): Promise<RealtimeEvent[]> {
  const q = since ? `?since=${encodeURIComponent(since)}` : '';
  const url = token ? `${q ? q + '&' : '?'}token=${encodeURIComponent(token)}` : q;
  // Token in query for SSE compat; server also accepts header
  const path = `/api/realtime/events${url}`;
  const res = await authFetch(path, { token: token ?? undefined });
  if (!res.ok) return [];
  const body = await res.json() as { events?: RealtimeEvent[] };
  return body.events ?? [];
}

export function getCurrentUserId(): string | null {
  return getActiveSession()?.user.id ?? null;
}

/** True if this event should trigger a vault pull (entire planner state). */
export function isVaultEvent(e: RealtimeEvent): boolean {
  return e.kind === 'vault:updated' || e.kind === 'sync:updated' || e.kind === 'vault:*';
}
/** True if this event is a guardian↔student link change that needs panel sync. */
export function isLinkEvent(e: RealtimeEvent): boolean {
  return e.kind === 'link:updated' || e.kind === 'link:note' || e.kind === 'link:share' || e.kind === 'link:linked' || e.kind === 'link:invited' || e.kind === 'link:removed' || e.kind === 'link:share-read';
}
export function isTypingEvent(e: RealtimeEvent): boolean { return e.kind === 'link:typing'; }
export function isPresenceEvent(e: RealtimeEvent): boolean { return e.kind === 'link:presence'; }
export function isReadEvent(e: RealtimeEvent): boolean { return e.kind === 'link:read'; }

/** Send ephemeral link event (typing/presence/read) to other side via server */
export async function sendLinkEvent(linkId: string, kind: 'typing' | 'presence' | 'read' | 'heartbeat', payload: Record<string, unknown> = {}): Promise<void> {
  if (!linkId || !getActiveSession()) return;
  const tok = await getRealtimeToken().catch(() => null);
  try {
    await authFetch('/api/realtime/link-event', {
      method: 'POST',
      token: tok ?? undefined,
      body: JSON.stringify({ linkId, kind, payload }),
    });
  } catch { /* best-effort */ }
}

export async function sendTyping(linkId: string, typing: boolean): Promise<void> {
  await sendLinkEvent(linkId, 'typing', { typing });
}
export async function sendPresence(linkId: string): Promise<void> {
  await sendLinkEvent(linkId, 'presence', { online: true });
}
export async function sendReadReceipt(linkId: string, messageId: string, messageCreatedAt?: string): Promise<void> {
  await sendLinkEvent(linkId, 'read', { messageId, messageCreatedAt: messageCreatedAt ?? null, at: new Date().toISOString() });
}

/**
 * Subscribe: tries SSE first (server push, ~0ms), falls back to polling (1.4s).
 * Returns stop().
 */
export function subscribeRealtime(
  intervalMs: number,
  onEvents: (events: RealtimeEvent[]) => void | Promise<void>,
  onStatus?: (s: 'polling' | 'error' | 'live') => void,
): () => void {
  let cancelled = false;
  let last = new Date(Date.now() - 15_000).toISOString();
  let failures = 0;
  let useSse = typeof window !== 'undefined' && typeof (window as unknown as { EventSource?: unknown }).EventSource !== 'undefined';
  let es: EventSource | null = null;
  let pollTimer: number | null = null;

  const tickPoll = async () => {
    if (cancelled || !getActiveSession()) { schedulePoll(); return; }
    try {
      const tok = await getRealtimeToken();
      const events = await fetchRealtimeEvents(last, tok);
      if (events.length) {
        last = events[events.length - 1]!.created_at;
        await onEvents(events);
      }
      failures = 0;
      onStatus?.('polling');
    } catch {
      failures += 1;
      onStatus?.('error');
    }
    schedulePoll();
  };

  const schedulePoll = () => {
    if (cancelled) return;
    const delay = failures ? Math.min(intervalMs * (failures + 1), 12_000) : intervalMs;
    pollTimer = window.setTimeout(() => void tickPoll(), delay) as unknown as number;
  };

  const startSse = async () => {
    if (!useSse || cancelled) { schedulePoll(); return; }
    const tok = await getRealtimeToken().catch(() => null);
    const origin = effectiveApiOrigin()?.replace(/\/+$/, '') ?? '';
    // SSE via query token (EventSource can't set Authorization header)
    const qs = tok ? `?token=${encodeURIComponent(tok)}` : '';
    const url = origin ? `${origin}/api/realtime/stream${qs}` : `/api/realtime/stream${qs}`;
    try {
      es = new window.EventSource(url, { withCredentials: true } as unknown as EventSourceInit);
    } catch {
      useSse = false;
      schedulePoll();
      return;
    }
    let open = false;
    const fallbackToPoll = () => {
      if (cancelled) return;
      try { es?.close(); } catch {}
      es = null;
      useSse = false;
      onStatus?.('polling');
      schedulePoll();
    };
    (es as unknown as { addEventListener: (t: string, fn: (e: MessageEvent) => void) => void }).addEventListener('open', () => {
      open = true;
      failures = 0;
      onStatus?.('live');
    });
    (es as unknown as { addEventListener: (t: string, fn: (e: MessageEvent) => void) => void }).addEventListener('error', () => {
      if (!open) fallbackToPoll();
      else {
        // transient error while open — keep SSE, but also poll once to catch gap
        failures += 1;
        onStatus?.('error');
      }
    });
    // Listen to all event kinds the server may send
    const kinds = ['vault:updated', 'sync:updated', 'link:updated', 'link:note', 'link:share', 'link:linked', 'link:invited', 'link:removed', 'link:share-read', 'link:typing', 'link:presence', 'link:read', 'link:heartbeat', 'heartbeat', 'hello'] as const;
    const handle = (e: MessageEvent) => {
      try {
        const data = JSON.parse((e as MessageEvent).data as string) as { id?: string; created_at?: string } & Record<string, unknown>;
        // hello/heartbeat are not real events
        if (e.type === 'hello' || e.type === 'heartbeat') {
          // Update last to server time to avoid duplicate poll gap
          if (data && typeof data.created_at === 'string') last = data.created_at;
          return;
        }
        // Real link/vault event: normalize to RealtimeEvent
        const ev: RealtimeEvent = {
          id: String(data.id ?? `${Date.now()}-${Math.random()}`),
          kind: e.type,
          payload: data,
          created_at: String(data.created_at ?? new Date().toISOString()),
        };
        last = ev.created_at;
        void onEvents([ev]);
      } catch {}
    };
    for (const k of kinds) {
      (es as unknown as { addEventListener: (t: string, fn: (e: MessageEvent) => void) => void }).addEventListener(k, handle as (e: MessageEvent) => void);
    }
    // Safety: if SSE never opens within 4s, fall back to poll
    window.setTimeout(() => { if (!open && es) fallbackToPoll(); }, 4000);
  };

  // Kick off: try SSE, else poll
  void startSse();
  // Also run one poll quickly to cover gap before SSE opens (idempotent)
  pollTimer = window.setTimeout(() => void tickPoll(), 900) as unknown as number;

  return () => {
    cancelled = true;
    if (pollTimer !== null) window.clearTimeout(pollTimer);
    try { es?.close(); } catch {}
  };
}

/** Subscribe only to ephemeral link events for a specific linkId */
export function subscribeLinkEphemeral(
  linkId: string,
  onEvent: (event: RealtimeEvent) => void,
): () => void {
  if (!linkId) return () => {};
  // Reuse the global poll but filter; cheap to create a second poller with longer interval for ephemeral only?
  // Instead, we hook into the main realtime via a lightweight poll that only cares about ephemeral kinds.
  // For simplicity, create a dedicated poller at 800ms for ephemeral.
  return subscribeRealtime(800, async (events) => {
    for (const e of events) {
      const p = e.payload as Record<string, unknown> | null;
      if (p && typeof p.linkId === 'string' && p.linkId === linkId && (isTypingEvent(e) || isPresenceEvent(e) || isReadEvent(e))) {
        onEvent(e);
      }
    }
  });
}

// --- BroadcastChannel: instant same-device multi-tab sync (no server) ---
const BC_NAME = 'planner-realtime';
let bc: BroadcastChannel | null = null;
function getBC(): BroadcastChannel | null {
  if (bc) return bc;
  if (typeof BroadcastChannel === 'undefined') return null;
  try { bc = new BroadcastChannel(BC_NAME); return bc; } catch { return null; }
}

export function broadcastLocal(kind: string, payload: unknown = {}): void {
  try { getBC()?.postMessage({ kind, payload, at: Date.now() }); } catch {}
}

export function subscribeLocal(onMessage: (msg: { kind: string; payload: unknown }) => void): () => void {
  const ch = getBC();
  if (!ch) return () => {};
  const handler = (ev: MessageEvent) => {
    const m = ev.data as { kind?: string; payload?: unknown };
    if (m && typeof m.kind === 'string') onMessage(m as { kind: string; payload: unknown });
  };
  ch.addEventListener('message', handler);
  return () => ch.removeEventListener('message', handler);
}

/** Pull remote vault, merge into current, return merged or null if no-op. */
export async function pullAndMerge(current: PlannerState): Promise<PlannerState | null> {
  const session = getActiveSession();
  if (!session) return null;
  const vault = await pullVault().catch(() => null);
  if (!vault) return null;
  if (vault.version === session.vault.version) return null;
  try {
    const remote = await decryptState(vault.ciphertext, session.dek);
    const merged = mergeStates(current, remote);
    return merged;
  } catch { return null; }
}
