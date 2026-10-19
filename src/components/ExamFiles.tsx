/**
 * File pickers and download buttons for file exams.
 *
 * Both halves do the encryption in this component's caller's service: pickers
 * encrypt on the device before the bytes leave it, downloads decrypt in memory
 * and either preview the plaintext in a browser tab or hand it to the share
 * sheet (native) / the browser download. Nothing plaintext is ever written to
 * disk or cached.
 */
import { useRef, useState } from 'react';
import { formatSize } from '../files';
import { t } from '../i18n';
import { CloseIcon, DownloadIcon, NoteIcon, TrashIcon, UploadIcon } from '../icons';
import {
  downloadEncryptedLinkFile,
  isPreviewableFile,
  openPreviewTab,
  saveOrShareBlob,
  showBlobInTab,
  uploadEncryptedLinkFile,
  validateLinkFile,
  type EncryptedLinkFile,
  type LinkFilePurpose,
} from '../linkMedia';
import { isNativeShell } from '../shared/nativeShell';
import type { ExamFile } from '../types';

/** One encrypted file, chosen and ready to upload. */
export function ExamFilePicker({
  linkId,
  wrappedShareKey,
  purpose,
  label,
  file,
  onUploaded,
  onClear,
  disabled,
}: {
  linkId: string;
  wrappedShareKey: string;
  purpose: LinkFilePurpose;
  label: string;
  file: ExamFile | null;
  onUploaded: (file: ExamFile) => void;
  onClear?: () => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const choose = async (picked: File | null) => {
    if (!picked || busy) return;
    const problem = validateLinkFile(picked);
    if (problem) {
      setError(t(problem));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const uploaded = await uploadEncryptedLinkFile(linkId, wrappedShareKey, picked, purpose);
      onUploaded(uploaded);
      if (inputRef.current) inputRef.current.value = '';
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('That file could not be uploaded.'));
    } finally {
      setBusy(false);
    }
  };

  if (file) {
    return (
      <div className="exam-file-card is-set">
        <div className="exam-file-meta">
          <p className="exam-file-name">{file.name}</p>
          <p className="exam-file-size">{formatSize(file.bytes)}</p>
        </div>
        <div className="exam-file-set-actions">
          <ExamFileDownload compact wrappedShareKey={wrappedShareKey} file={file} />
          {onClear && !disabled ? (
            <button type="button" className="icon-btn" aria-label={t('Remove file')} onClick={onClear}>
              <TrashIcon size={15} />
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="exam-file-card">
      <input
        ref={inputRef}
        id={`file-${purpose}-${linkId}`}
        className="exam-file-input"
        type="file"
        disabled={disabled || busy}
        onChange={(event) => void choose(event.target.files?.[0] ?? null)}
      />
      <label className="exam-file-drop" htmlFor={`file-${purpose}-${linkId}`}>
        {busy ? <span className="spinner" aria-hidden="true" /> : <UploadIcon size={18} />}
        <span className="exam-file-drop-label">{busy ? t('Encrypting and sending…') : label}</span>
        <span className="exam-file-drop-hint">{t('Any file type, up to 20 MB. Encrypted on this device.')}</span>
      </label>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Download (or share, on a phone) an encrypted file after decrypting it, with
 * an in-website Preview for file types the browser can render. `compact`
 * renders a single small chip suited to exam list rows.
 */
export function ExamFileDownload({
  wrappedShareKey,
  file,
  label,
  compact = false,
}: {
  wrappedShareKey: string;
  file: EncryptedLinkFile;
  label?: string;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState<'' | 'preview' | 'download'>('');
  const [error, setError] = useState('');
  const canPreview = !isNativeShell() && isPreviewableFile(file);

  const decrypt = async (mode: 'preview' | 'download') => {
    if (busy) return;
    // The preview tab must exist before the first await or the popup blocker
    // eats it; it only navigates once the plaintext has been decrypted.
    const tab = mode === 'preview' && canPreview ? openPreviewTab() : null;
    setBusy(mode);
    setError('');
    try {
      const blob = await downloadEncryptedLinkFile(wrappedShareKey, file);
      if (mode === 'preview' && tab) {
        showBlobInTab(tab, blob);
        return;
      }
      // No tab (blocked) or plain download: the share sheet / anchor path.
      await saveOrShareBlob(blob, file.name);
    } catch (caught) {
      tab?.close();
      setError(caught instanceof Error ? caught.message : t('That file could not be opened.'));
    } finally {
      setBusy('');
    }
  };

  if (compact) {
    return (
      <span className="exam-file-chip-wrap">
        <button
          type="button"
          className="exam-file-chip"
          title={file.name}
          aria-label={`${t('Download questions')}: ${file.name}`}
          onClick={() => void decrypt('download')}
        >
          {busy ? <span className="spinner" aria-hidden="true" /> : <DownloadIcon size={13} />}
          <span className="exam-file-chip-label">{label ?? file.name}</span>
        </button>
        {canPreview ? (
          <button
            type="button"
            className="exam-file-chip is-preview"
            title={t('Preview')}
            aria-label={`${t('Preview')}: ${file.name}`}
            onClick={() => void decrypt('preview')}
          >
            {busy === 'preview' ? <span className="spinner" aria-hidden="true" /> : <NoteIcon size={13} />}
            <span className="exam-file-chip-label">{t('Preview')}</span>
          </button>
        ) : null}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </span>
    );
  }

  return (
    <span className="exam-file-download-wrap">
      <span className="exam-file-download-row">
        <button type="button" className="btn btn-outline btn-small exam-file-download" onClick={() => void decrypt('download')}>
          {busy === 'download' ? <span className="spinner" aria-hidden="true" /> : <DownloadIcon size={14} />}
          {label ?? t('Download questions')}
        </button>
        {canPreview ? (
          <button type="button" className="btn btn-ghost btn-tiny exam-file-preview" onClick={() => void decrypt('preview')}>
            {busy === 'preview' ? <span className="spinner" aria-hidden="true" /> : <NoteIcon size={14} />}
            {t('Preview')}
          </button>
        ) : null}
      </span>
      <span className="exam-file-subline">
        {file.name} · {formatSize(file.bytes)}
      </span>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </span>
  );
}

/** Small remove button used by uploaded answer-file lists. */
export function ExamFileRemove({ onRemove, label }: { onRemove: () => void; label: string }) {
  return (
    <button type="button" className="icon-btn" aria-label={label} title={label} onClick={onRemove}>
      <CloseIcon size={14} />
    </button>
  );
}
