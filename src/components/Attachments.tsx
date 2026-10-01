import { useEffect, useState } from 'react';
import { attachmentKind, attachmentObjectUrl, formatSize } from '../files';
import { t } from '../i18n';
import { DownloadIcon, NoteIcon, VolumeIcon, CloseIcon } from '../icons';
import type { AttachmentRef } from '../types';

/**
 * Renders a note's stored files. Audio gets an inline player, images a
 * thumbnail preview, everything else a download chip. Bytes live in
 * IndexedDB; this reads them on demand and revokes the object URL on unmount.
 * Blobs missing on this device (old exports, fresh installs) show an honest
 * "missing" state instead of spinning forever.
 */

type LoadState = 'loading' | 'missing' | string;

type RemoveHandler = (ref: AttachmentRef) => void;

function useAttachmentUrl(ref: AttachmentRef, want: boolean): LoadState | null {
  const [state, setState] = useState<LoadState | null>(want ? 'loading' : null);
  useEffect(() => {
    if (!want) {
      setState(null);
      return undefined;
    }
    setState('loading');
    let live = true;
    let objectUrl: string | null = null;
    void attachmentObjectUrl(ref).then((value) => {
      if (!live) return;
      objectUrl = value;
      setState(value ?? 'missing');
    });
    return () => {
      live = false;
      if (objectUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(objectUrl);
    };
  }, [ref, want]);
  return state;
}

function KindGlyph({ kind }: { kind: ReturnType<typeof attachmentKind> }) {
  if (kind === 'audio') return <VolumeIcon size={13} />;
  return <NoteIcon size={13} />;
}

/** One downloadable chip (used for every non-image/audio file, plus fallbacks). */
function AttachmentChip({ item, onRemove, missing }: { item: AttachmentRef; onRemove?: RemoveHandler; missing?: boolean }) {
  const url = useAttachmentUrl(item, onRemove === undefined && missing === undefined);
  const href = typeof url === 'string' && url.startsWith('blob:') ? url : null;
  return (
    <span className={missing || url === 'missing' ? 'attach-chip missing' : 'attach-chip'}>
      <span className="attach-icon" aria-hidden="true"><KindGlyph kind={attachmentKind(item.mime, item.name)} /></span>
      <span className="attach-name" title={item.name}>{item.name}</span>
      {missing || url === 'missing' ? (
        <span className="attach-size">{t("not on this device")}</span>
      ) : (
        <span className="attach-size">{formatSize(item.size)}</span>
      )}
      {href ? (
        <a className="icon-btn attach-dl" href={href} download={item.name} aria-label={t("Download {0}", { 0: item.name })}>
          <DownloadIcon size={14} />
        </a>
      ) : null}
      {onRemove ? (
        <button type="button" className="icon-btn attach-rm" aria-label={t("Remove attachment {0}", { 0: item.name })} onClick={() => onRemove(item)}>
          <CloseIcon size={13} />
        </button>
      ) : null}
    </span>
  );
}

function ImageAttachment({ item, onRemove }: { item: AttachmentRef; onRemove?: RemoveHandler }) {
  const url = useAttachmentUrl(item, true);
  if (url === 'loading' || url === null) {
    return <span className="attach-image loading" aria-hidden="true" />;
  }
  if (url === 'missing') {
    return <AttachmentChip item={item} onRemove={onRemove} missing />;
  }
  return (
    <span className="attach-image">
      <a href={url} target="_blank" rel="noopener noreferrer" aria-label={t("Open {0}", { 0: item.name })}>
        <img src={url} alt={item.name} loading="lazy" />
      </a>
      {onRemove ? (
        <button type="button" className="icon-btn attach-rm attach-rm-img" aria-label={t("Remove attachment {0}", { 0: item.name })} onClick={() => onRemove(item)}>
          <CloseIcon size={13} />
        </button>
      ) : null}
    </span>
  );
}

function AudioAttachment({ item, onRemove }: { item: AttachmentRef; onRemove?: RemoveHandler }) {
  const url = useAttachmentUrl(item, true);
  return (
    <span className="attach-audio">
      {typeof url === 'string' && url !== 'missing' && url !== 'loading' ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption -- user-provided files have no captions available
        <audio controls src={url} preload="metadata" aria-label={item.name} />
      ) : url === 'loading' || url === null ? (
        <span className="meta">{t("Loading audio…")}</span>
      ) : null}
      <AttachmentChip item={item} onRemove={onRemove} missing={url === 'missing'} />
    </span>
  );
}

export function AttachmentList({ refs: items, onRemove }: { refs: AttachmentRef[]; onRemove?: RemoveHandler }) {
  if (!items.length) return null;
  const images = items.filter((ref) => attachmentKind(ref.mime, ref.name) === 'image');
  const rest = items.filter((ref) => attachmentKind(ref.mime, ref.name) !== 'image');
  return (
    <div className="attach-list" aria-label={t("Attached files")}>
      {images.map((item) => <ImageAttachment key={item.id} item={item} onRemove={onRemove} />)}
      {rest.map((item) => {
        const kind = attachmentKind(item.mime, item.name);
        if (kind === 'audio') return <AudioAttachment key={item.id} item={item} onRemove={onRemove} />;
        return <AttachmentChip key={item.id} item={item} onRemove={onRemove} />;
      })}
    </div>
  );
}
