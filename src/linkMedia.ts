/**
 * Encrypted file transfer over a guardian/student link.
 *
 * The homework-photo pipeline proved the shape: encrypt on the device with
 * the link key, upload ciphertext straight to Cloudinary's raw store, and let
 * only the small pointer (url, id, name, mime, size) travel in the encrypted
 * outbox. This generalises it from photos to any exam paper: question papers
 * flow guardian → student, answer papers the other way, and the server never
 * holds a byte it could read.
 */
import { decryptBinaryBytes, encryptBinaryBytes, importDek, unwrapKeyRaw } from './auth/crypto';
import { getActiveSession, request } from './auth/session';
import { isNativeShell } from './shared/nativeShell';
import { downloadBlob } from './download';

export const LINK_FILE_MAX_BYTES = 20 * 1024 * 1024; // 20 MB — any file type
export const LINK_FILES_MAX = 12;

export type LinkFilePurpose = 'exam-question' | 'exam-answer';

/** The light pointer that syncs; the bytes themselves stay in the cloud. */
export interface EncryptedLinkFile {
  url: string;
  publicId: string;
  name: string;
  mime: string;
  bytes: number;
}

interface UploadSignature {
  cloudName: string;
  apiKey: string;
  publicId: string;
  timestamp: number;
  signature: string;
}

function linkKey(wrappedShareKey: string): Promise<CryptoKey> {
  const session = getActiveSession();
  if (!session) throw new Error('Sign in before uploading files.');
  return unwrapKeyRaw(wrappedShareKey, session.dek).then((raw) => importDek(raw, false));
}

function cleanName(name: string): string {
  const trimmed = name.trim().slice(0, 180);
  return trimmed || 'file';
}

/** Validate one file the way both sides agree, before any bytes move. */
export function validateLinkFile(file: File): string | null {
  if (file.size < 1) return 'That file is empty.';
  if (file.size > LINK_FILE_MAX_BYTES) return 'Files are capped at 20 MB each.';
  if (cleanName(file.name).length > 180) return 'That file name is too long.';
  return null;
}

/** Encrypt locally with the link key, then upload the ciphertext directly. */
export async function uploadEncryptedLinkFile(
  linkId: string,
  wrappedShareKey: string,
  file: File,
  purpose: LinkFilePurpose,
): Promise<EncryptedLinkFile> {
  const problem = validateLinkFile(file);
  if (problem) throw new Error(problem);
  const signed = await request<UploadSignature>('/api/auth/link-files/sign', {
    method: 'POST',
    body: JSON.stringify({ linkId, purpose }),
  });
  if (!/^[a-z0-9-]{2,100}$/i.test(signed.cloudName) || !signed.publicId || !signed.signature) {
    throw new Error('The file upload could not be prepared.');
  }
  const key = await linkKey(wrappedShareKey);
  const plaintext = new Uint8Array(await file.arrayBuffer());
  const encrypted = await encryptBinaryBytes(plaintext, key);
  plaintext.fill(0);

  const form = new FormData();
  form.set('api_key', signed.apiKey);
  form.set('timestamp', String(signed.timestamp));
  form.set('public_id', signed.publicId);
  form.set('signature', signed.signature);
  form.set('file', new Blob([encrypted], { type: 'application/octet-stream' }), 'encrypted.bin');
  const response = await fetch(`https://api.cloudinary.com/v1_1/${signed.cloudName}/raw/upload`, {
    method: 'POST',
    body: form,
    credentials: 'omit',
  });
  const payload = await response.json().catch(() => null) as {
    secure_url?: unknown;
    public_id?: unknown;
    error?: { message?: unknown };
  } | null;
  if (!response.ok || typeof payload?.secure_url !== 'string' || typeof payload.public_id !== 'string') {
    const message = typeof payload?.error?.message === 'string' ? payload.error.message : 'The encrypted file could not be uploaded.';
    throw new Error(message.slice(0, 160));
  }
  if (payload.public_id !== signed.publicId) throw new Error('The file host returned an unexpected file.');
  return {
    url: payload.secure_url,
    publicId: payload.public_id,
    name: cleanName(file.name),
    mime: file.type || 'application/octet-stream',
    bytes: file.size,
  };
}

/** Fetch ciphertext and decrypt only in memory. Nothing plaintext is cached. */
export async function downloadEncryptedLinkFile(
  wrappedShareKey: string,
  ref: EncryptedLinkFile,
): Promise<Blob> {
  const response = await fetch(ref.url, { credentials: 'omit', cache: 'no-store' });
  if (!response.ok) throw new Error('This file is no longer available.');
  const ciphertext = new Uint8Array(await response.arrayBuffer());
  const key = await linkKey(wrappedShareKey);
  const plaintext = await decryptBinaryBytes(ciphertext, key);
  return new Blob([plaintext], { type: ref.mime || 'application/octet-stream' });
}

/** Remove cloud assets when a paper is replaced or taken back. */
export async function deleteLinkFileAssets(linkId: string, refs: EncryptedLinkFile[]): Promise<void> {
  if (refs.length === 0) return;
  if (refs.length > LINK_FILES_MAX) throw new Error('Too many files to delete.');
  await request('/api/auth/link-files/delete', {
    method: 'POST',
    body: JSON.stringify({ linkId, publicIds: refs.map((ref) => ref.publicId) }),
  });
}

/** File types a browser tab can render directly, so we can preview in-app. */
export function isPreviewableFile(ref: Pick<EncryptedLinkFile, 'mime'>): boolean {
  const mime = ref.mime || '';
  return (
    mime === 'application/pdf' ||
    mime.startsWith('image/') ||
    mime.startsWith('text/') ||
    mime.startsWith('audio/') ||
    mime.startsWith('video/') ||
    mime === 'application/json'
  );
}

/**
 * In-website preview: open the tab synchronously inside the click (popup
 * blockers kill a window.open that happens after an await), then navigate it to
 * the decrypted bytes once they arrive. Returns null when no tab could be
 * opened, so the caller can fall back to a normal download.
 */
export function openPreviewTab(): Window | null {
  if (typeof window === 'undefined') return null;
  return window.open('about:blank', '_blank', 'noopener,noreferrer');
}

/** Point the preview tab at the decrypted blob; the URL outlives the call. */
export function showBlobInTab(tab: Window, blob: Blob): void {
  if (typeof URL === 'undefined') throw new Error('This browser cannot preview files.');
  const url = URL.createObjectURL(blob);
  try {
    tab.location.href = url;
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  // The tab may still be reading the URL when this returns, so revoke late.
  window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

/**
 * Hand a decrypted blob to the user.
 *
 * In a browser the anchor download is the reliable path (and works in the
 * installed PWA). In a native shell iOS Safari/WebView often opens blobs
 * instead of downloading them, so prefer the Share sheet there — "Save to
 * Files" is one tap — and only fall back when sharing files is unavailable.
 */
export async function saveOrShareBlob(blob: Blob, filename: string): Promise<void> {
  const nav = navigator as Navigator & {
    canShare?: (data?: { files?: File[] }) => boolean;
    share?: (data: { files: File[]; title?: string }) => Promise<void>;
  };
  const file = new File([blob], filename, { type: blob.type });
  if (isNativeShell() && typeof nav.canShare === 'function' && typeof nav.share === 'function') {
    try {
      if (nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], title: filename });
        return;
      }
    } catch (error) {
      // A cancelled share is not a failure; everything else falls through to
      // the ordinary download, which still opens the file for saving.
      if ((error as { name?: string })?.name === 'AbortError') return;
    }
  }
  downloadBlob(blob, filename);
}
