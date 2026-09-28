import { useEffect, useState } from 'react';
import { attachmentKind, attachmentObjectUrl, formatSize } from '../files';
import { t } from '../i18n';
import { DownloadIcon, NoteIcon, MicIcon, CloseIcon } from '../icons';
import type { AttachmentRef } from '../types';

/**
 * Renders a note's stored files. Audio gets an inline player, images a
 * thumbnail preview, everything else a download chip. Bytes live in
 * IndexedDB; this reads them on demand and revokes the object URL on unmount.
 */

function useAttachmentUrl(ref: AttachmentRef, want: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!want) return undefined;
    let live = true;
    let objectUrl: string | null = null;
    void attachmentObjectUrl(ref).then((value) => {
      if (!live) return;
      objectUrl = value;
      setUrl(value);
    });
    return () => {
      live = false;
      if (objectUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(objectUrl);
    };
  }, [ref, want]);
  return url;
}

function KindGlyph({ kind }: { kind: ReturnType<typeof attachmentKind> }) {
  if (kind === 'audio') return <MicIcon size={13} />;
  if (kind === 'image') return <NoteIcon size={13} />;
  return <NoteIcon size={13} />;
}

/** One downloadable chip (used for every non-image/audio file, plus fallbacks). */
function AttachmentChip({ ref_: item, onRemove }: { ref_: AttachmentRef; onRemove?: (ref: AttachmentRef) => void }) {
  const url = useAttachmentUrl(item, onRemove === undefined);
  return (
    <span className="attach-chip">
      <span className="attach-icon" aria-hidden="true"><KindGlyph kind={attachmentKind(item.mime, item.name)} /></span>
      <span className="attach-name" title={item.name}>{item.name}</span>
      <span className="attach-size">{formatSize(item.size)}</span>
      {url ? (
        <a className="icon-btn attach-dl" href={url} download={item.name} aria-label={t("Download {0}", { 0: item.name })}>
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

function ImageAttachment({ item }: { item: AttachmentRef }) {
  const url = useAttachmentUrl(item, true);
  return url ? (
    <a className="attach-image" href={url} target="_blank" rel="noreferrer" aria-label={t("Open {0}", { 0: item.name })}>
      <img src={url} alt={item.name} loading="lazy" />
    </a>
  ) : (
    <AttachmentChip ref_={item} />
  );
}

function AudioAttachment({ item }: { item: AttachmentRef }) {
  const url = useAttachmentUrl(item, true);
  return (
    <span className="attach-audio">
      {url ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption -- user-provided files have no captions available
        <audio controls src={url} preload="metadata" aria-label={item.name} />
      ) : (
        <span className="meta">{t("Loading audio…")}</span>
      )}
      <AttachmentChip ref_={item} />
    </span>
  );
}

export function AttachmentList({ refs: items, onRemove }: { refs: AttachmentRef[]; onRemove?: (ref: AttachmentRef) => void }) {
  if (!items.length) return null;
  const images = items.filter((ref) => attachmentKind(ref.mime, ref.name) === 'image');
  const rest = items.filter((ref) => attachmentKind(ref.mime, ref.name) !== 'image');
  return (
    <div className="attach-list" aria-label={t("Attached files")}>
      {images.map((item) => <ImageAttachment key={item.id} item={item} />)}
      {rest.map((item) => {
        const kind = attachmentKind(item.mime, item.name);
        if (kind === 'audio') return <AudioAttachment key={item.id} item={item} />;
        return <AttachmentChip key={item.id} ref_={item} onRemove={onRemove} />;
      })}
    </div>
  );
}
