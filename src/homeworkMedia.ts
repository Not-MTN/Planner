import { decryptBinaryBytes, encryptBinaryBytes, importDek, unwrapKeyRaw } from './auth/crypto';
import { getActiveSession, request } from './auth/session';
import { HOMEWORK_PHOTOS_MAX } from './types';
import type { HomeworkPhoto } from './types';
import { sanitizeHomeworkPhoto } from './learning';

export const HOMEWORK_PHOTO_MAX_BYTES = 8 * 1024 * 1024;
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

interface CloudinaryUploadSignature {
  cloudName: string;
  apiKey: string;
  publicId: string;
  timestamp: number;
  signature: string;
}

function linkKey(wrappedShareKey: string): Promise<CryptoKey> {
  const session = getActiveSession();
  if (!session) throw new Error('Sign in before uploading homework photos.');
  return unwrapKeyRaw(wrappedShareKey, session.dek).then((raw) => importDek(raw, false));
}

/** Encrypt locally with the link key, then upload ciphertext directly to Cloudinary. */
export async function uploadEncryptedHomeworkPhoto(
  linkId: string,
  wrappedShareKey: string,
  file: File,
): Promise<HomeworkPhoto> {
  if (!PHOTO_TYPES.has(file.type)) throw new Error('Choose a JPEG, PNG, or WebP photo.');
  if (file.size < 1 || file.size > HOMEWORK_PHOTO_MAX_BYTES) throw new Error('Each homework photo must be 8 MB or smaller.');
  const signed = await request<CloudinaryUploadSignature>('/api/auth/homework-photos/sign', {
    method: 'POST',
    body: JSON.stringify({ linkId }),
  });
  if (!/^[a-z0-9-]{2,100}$/i.test(signed.cloudName) || !signed.publicId || !signed.signature) {
    throw new Error('The photo upload could not be prepared.');
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
  form.set('file', new Blob([encrypted], { type: 'application/octet-stream' }), 'encrypted-homework.bin');
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
    const message = typeof payload?.error?.message === 'string' ? payload.error.message : 'The encrypted photo could not be uploaded.';
    throw new Error(message.slice(0, 160));
  }
  const photo = sanitizeHomeworkPhoto({
    url: payload.secure_url,
    publicId: payload.public_id,
    name: file.name,
    mime: file.type,
    bytes: file.size,
  });
  if (!photo || photo.publicId !== signed.publicId) throw new Error('The photo host returned an unexpected file.');
  return photo;
}

/** Guardian-side preview: fetch ciphertext, decrypt only in memory, return a blob. */
export async function decryptHomeworkPhoto(wrappedShareKey: string, photo: HomeworkPhoto): Promise<Blob> {
  const response = await fetch(photo.url, { credentials: 'omit', cache: 'no-store' });
  if (!response.ok) throw new Error('This homework photo is no longer available.');
  const ciphertext = new Uint8Array(await response.arrayBuffer());
  const key = await linkKey(wrappedShareKey);
  const plaintext = await decryptBinaryBytes(ciphertext, key);
  return new Blob([plaintext], { type: photo.mime });
}

/** Guardian: delete cloud assets before sending the approval metadata. */
export async function deleteHomeworkPhotoAssets(linkId: string, photos: HomeworkPhoto[]): Promise<void> {
  if (photos.length === 0) return;
  if (photos.length > HOMEWORK_PHOTOS_MAX) throw new Error('Too many homework photos to delete.');
  await request('/api/auth/homework-photos/delete', {
    method: 'POST',
    body: JSON.stringify({ linkId, publicIds: photos.map((photo) => photo.publicId) }),
  });
}
