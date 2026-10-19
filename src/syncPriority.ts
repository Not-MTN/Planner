/**
 * Who currently needs fresh link data, and how quickly.
 *
 * The sync scheduler lives in app state, but the thing that makes a thread
 * urgent — a chat screen being open — lives inside a tab deep in the panel
 * views. Rather than threading "is the chat open" props through every layer,
 * interested screens acquire a priority while mounted and release it on
 * unmount. Reference counted, so two open threads behave exactly like one.
 *
 * The module is framework-free on purpose: the scheduler effect subscribes
 * once, and tests can drive it without rendering React.
 */
import { highestPriority, priorityFromHeld, type SyncPriority } from './syncScheduler';

type Listener = (priority: SyncPriority) => void;

const held: SyncPriority[] = [];
const listeners = new Set<Listener>();

function emit(): void {
  const current = priorityFromHeld(held);
  for (const listener of listeners) listener(current);
}

/** Hold a priority until the returned release is called (e.g. in an effect cleanup). */
export function acquireSyncPriority(priority: SyncPriority): () => void {
  held.push(priority);
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const at = held.indexOf(priority);
    if (at >= 0) held.splice(at, 1);
    emit();
  };
}

export function subscribeSyncPriority(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function currentSyncPriority(): SyncPriority {
  return held.reduce<SyncPriority>((best, entry) => highestPriority(best, entry), 'idle');
}
