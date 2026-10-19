/**
 * Seeing the page before it goes to paper.
 *
 * Printing used to be a button that opened a window and hoped: no way to check
 * that the week fitted, that the times were right, or that the fonts had
 * loaded. This puts the very document that would be printed on screen first —
 * the same HTML, in a frame of its own — with the two ways out beside it:
 * print it, or keep it as a file.
 *
 * Beside them is the one setting paper has that a screen does not: which way
 * round it goes. Portrait and landscape are different pages, not the same page
 * squeezed, so the document is rebuilt for the choice rather than left to the
 * print dialogue to guess at. "Fit the screen" is the default and follows the
 * shape the reader is holding.
 *
 * The frame is sandboxed without scripts. The document is generated here from
 * the planner's own data and escaped on the way in, so it needs none, and a
 * page that cannot run anything cannot be talked into running something.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePlanner } from '../context';
import { cx } from '../cx';
import { t } from '../i18n';
import { DownloadIcon, PrinterIcon } from '../icons';
import { downloadBlob } from '../download';
import { printDocument } from '../printDocument';
import type { PrintOrientation } from '../weekPlanPrint';
import { Modal } from './ui';

/** One page the preview can show: the plan as a story, or as a wall timetable. */
export interface PrintableDocument {
  id: string;
  label: string;
  html: string;
  filename: string;
}

/** What a builder is told before it lays the pages out. */
export interface PrintLayout {
  orientation: PrintOrientation;
  /** Whether the reader's screen is wide — what 'auto' follows. */
  wide: boolean;
}

const ORIENTATIONS: Array<{ id: PrintOrientation; label: string }> = [
  { id: 'auto', get label() { return t('Fit the screen'); } },
  { id: 'portrait', get label() { return t('Portrait'); } },
  { id: 'landscape', get label() { return t('Landscape'); } },
];

/** Is the screen wide right now? A phone is not; a desk usually is. */
function useWide(breakpoint = 900): boolean {
  const [wide, setWide] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(`(min-width: ${breakpoint}px)`).matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(`(min-width: ${breakpoint}px)`);
    const onChange = () => setWide(query.matches);
    onChange();
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, [breakpoint]);
  return wide;
}

export function PrintPreview({
  title,
  build,
  onClose,
}: {
  title: string;
  /** The pages, rebuilt whenever the way round changes. */
  build: (layout: PrintLayout) => PrintableDocument[];
  onClose: () => void;
}) {
  const { flash } = usePlanner();
  const frame = useRef<HTMLIFrameElement>(null);
  const [active, setActive] = useState(0);
  const [ready, setReady] = useState(false);
  const [orientation, setOrientation] = useState<PrintOrientation>('auto');
  const wide = useWide();
  const documents = useMemo(() => build({ orientation, wide }), [build, orientation, wide]);
  const document = documents[Math.min(active, documents.length - 1)];

  useEffect(() => setReady(false), [document?.id, orientation]);

  if (!document) return null;

  const print = () => {
    // The frame is the page: printing it prints exactly what is on screen. A
    // frame that will not print — blocked, or not ours to reach — falls back to
    // a window of its own, and only then to a file, so the button always does
    // something the reader can see.
    const win = frame.current?.contentWindow;
    try {
      if (win) {
        win.focus();
        win.print();
        return;
      }
    } catch {
      /* reach it the other way */
    }
    if (printDocument(document.html)) return;
    downloadBlob(new Blob([document.html], { type: 'text/html;charset=utf-8' }), document.filename);
    flash(t('Pop-ups are blocked, so the page was saved as a file instead.'));
  };

  const download = () => {
    downloadBlob(new Blob([document.html], { type: 'text/html;charset=utf-8' }), document.filename);
    flash(t('Saved to your downloads.'));
  };

  return (
    <Modal title={title} onClose={onClose} className="sheet-print-preview">
      <div className="print-preview">
        <div className="print-preview-bar">
          {documents.length > 1 ? (
            <div className="print-preview-tabs" role="tablist" aria-label={t('Page')}>
              {documents.map((entry, index) => (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={index === active}
                  className={cx('btn btn-ghost btn-tiny', index === active && 'is-on')}
                  onClick={() => setActive(index)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          ) : (
            <span className="print-preview-label">{document.label}</span>
          )}
          <div className="print-preview-orient" role="group" aria-label={t('Paper')}>
            {ORIENTATIONS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={cx('btn btn-ghost btn-tiny', orientation === entry.id && 'is-on')}
                aria-pressed={orientation === entry.id}
                onClick={() => setOrientation(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <div className="print-preview-actions">
            <button type="button" className="btn btn-primary btn-small" disabled={!ready} onClick={print}>
              <PrinterIcon size={14} />
              {t('Print')}
            </button>
            <button type="button" className="btn btn-ghost btn-small" disabled={!ready} onClick={download}>
              <DownloadIcon size={14} />
              {t('Download')}
            </button>
          </div>
        </div>
        <p className="hint">
          {t('One page, whichever way round you pick — nothing else from the app goes on it.')}
        </p>
        <div className="print-preview-stage" data-orientation={wide || orientation === 'landscape' ? 'landscape' : 'portrait'}>
          <iframe
            ref={frame}
            className="print-preview-frame"
            title={document.label}
            srcDoc={document.html}
            sandbox="allow-same-origin allow-modals"
            onLoad={() => setReady(true)}
          />
          {ready ? null : (
            <p className="print-preview-loading" role="status">
              <span className="spinner" aria-hidden="true" />
              {t('Loading the page…')}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
