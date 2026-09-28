/**
 * Local file attachments (music, documents, images…). Bytes live in IndexedDB
 * under `file:<id>` keys; notes carry only the light AttachmentRef metadata,
 * which syncs/exports with the rest of the state. Pure helpers are exported
 * separately so the sync layer (Node, no DOM) stays importable from files.node.
 */
import { idbClear, idbKeysWithPrefix, idbReadBlob, idbWriteBlob } from './idb';
import { t } from './i18n';
import type { AttachmentRef } from './types';

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // 20 MB — generous for local blobs
export const MAX_ATTACHMENTS_PER_NOTE = 12;

export const ATTACHMENT_KEY_PREFIX = 'file:';

export type AttachmentKind = 'audio' | 'image' | 'file';

export function attachmentKind(mime: string, name = ''): AttachmentKind {
  const type = (mime || '').toLowerCase();
  if (type.startsWith('audio/') || /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|wma)$/i.test(name)) return 'audio';
  if (type.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif|bmp|svg|heic|heif)$/i.test(name)) return 'image';
  return 'file';
}

export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

let counter = 0;
function newId(): string {
  counter = (counter + 1) % 46656;
  return `att-${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface StoreResult {
  ref?: AttachmentRef;
  error?: 'too-large' | 'unavailable';
}

/** One honest sentence for whatever a batch of files did (shared by composer + context). */
export function attachmentNotice(attached: number, tooLarge: number, failed: number, overflow: number, firstName: string): string | null {
  const lines: string[] = [];
  if (attached === 1) lines.push(t('Attached {0}', { 0: firstName }));
  else if (attached > 1) lines.push(t('Attached {0} files', { 0: attached }));
  if (tooLarge > 0) lines.push(t('{0} too large — files are capped at 20 MB each', { 0: tooLarge }));
  if (failed > 0) lines.push(t("Couldn't save {0} — this device's storage is full", { 0: failed }));
  if (overflow > 0) lines.push(t("{0} didn't fit — a note holds up to 12 files", { 0: overflow }));
  return lines.length > 0 ? lines.join('. ') : null;
}

/** Persist one file's bytes and return its metadata ref. */
export async function storeAttachment(file: File | Blob, name: string, mime: string): Promise<StoreResult> {
  if (file.size > MAX_ATTACHMENT_BYTES) return { error: 'too-large' };
  const id = newId();
  const ok = await idbWriteBlob(`${ATTACHMENT_KEY_PREFIX}${id}`, file);
  if (!ok) return { error: 'unavailable' };
  return {
    ref: {
      id,
      name: name.slice(0, 180) || 'file',
      mime: mime || 'application/octet-stream',
      size: file.size,
      addedAt: new Date().toISOString(),
    },
  };
}

/** Load the blob for a ref (null when unavailable/missing). */
export async function readAttachmentBlob(ref: AttachmentRef): Promise<Blob | null> {
  return idbReadBlob(`${ATTACHMENT_KEY_PREFIX}${ref.id}`);
}

/** Delete bytes for refs (when an attachment or its note is removed). */
export async function deleteAttachmentBlobs(refs: AttachmentRef[]): Promise<void> {
  await Promise.all(refs.map((ref) => idbClear(`${ATTACHMENT_KEY_PREFIX}${ref.id}`)));
}

/** Create an object URL for rendering; caller revokes it. */
export async function attachmentObjectUrl(ref: AttachmentRef): Promise<string | null> {
  try {
    const blob = await readAttachmentBlob(ref);
    if (!blob) return null;
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

/**
 * Orphan sweep: attachment bytes whose refs no longer exist anywhere in the
 * state (deleted notes, discarded drafts, removed files). Runs on boot, so
 * undo always has a full session to restore its blobs first.
 */
export async function sweepAttachmentBlobs(state: { notes: Array<{ attachments?: AttachmentRef[] }> }): Promise<number> {
  const keep = referencedAttachmentIds(state);
  const keys = await idbKeysWithPrefix(ATTACHMENT_KEY_PREFIX); // full keys like "file:<id>"
  const orphans = keys.filter((key) => !keep.has(key.slice(ATTACHMENT_KEY_PREFIX.length)));
  await Promise.all(orphans.map((key) => idbClear(key)));
  return orphans.length;
}

/** Every attachment ref across the whole planner state (for orphan cleanup). */
export function referencedAttachmentIds(state: { notes: Array<{ attachments?: AttachmentRef[] }> }): Set<string> {
  const ids = new Set<string>();
  for (const note of state.notes) {
    for (const ref of note.attachments ?? []) ids.add(ref.id);
  }
  return ids;
}

