/**
 * Local file attachments (music, documents, images…). Bytes live in IndexedDB
 * under `file:<id>` keys; notes carry only the light AttachmentRef metadata,
 * which syncs/exports with the rest of the state. Pure helpers are exported
 * separately so the sync layer (Node, no DOM) stays importable from files.node.
 */
import { idbClear, idbReadBlob, idbWriteBlob } from './idb';
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

/** Every attachment ref across the whole planner state (for orphan cleanup). */
export function referencedAttachmentIds(state: { notes: Array<{ attachments?: AttachmentRef[] }> }): Set<string> {
  const ids = new Set<string>();
  for (const note of state.notes) {
    for (const ref of note.attachments ?? []) ids.add(ref.id);
  }
  return ids;
}

