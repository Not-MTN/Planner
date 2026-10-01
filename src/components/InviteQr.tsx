import { useMemo, useState } from 'react';
import { encodeQr, qrSvgPath } from '../qr';
import { inviteLink } from '../route';
import { t } from '../i18n';

/**
 * Guardian: a QR code for an invite, so the code can be handed over by camera
 * instead of by typing.
 *
 * The symbol carries a link, not the bare code, because the thing a student
 * wants after scanning is their own panel with the code already in place — not
 * a string of sixteen characters to retype from memory. The link stays
 * relative to wherever this is shown, so a self-hosted copy hands out its own
 * address and not ours.
 *
 * The symbol is drawn as one path rather than a few hundred rectangles: same
 * picture, a fraction of the nodes.
 */
export function InviteQr({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const drawing = useMemo(() => {
    const origin = typeof window === 'undefined' ? '' : window.location.origin;
    const link = inviteLink(code, origin);
    try {
      // A symbol too big to scan is worse than no symbol, so nothing is drawn
      // if the text will not fit. The code above it still works by hand.
      return { link, ...qrSvgPath(encodeQr(link)) };
    } catch {
      return { link, path: '', viewBox: '' };
    }
  }, [code]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(drawing.link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  if (!drawing.path) return null;

  return (
    <div className="qr-block">
      <svg
        className="qr"
        viewBox={drawing.viewBox}
        shapeRendering="crispEdges"
        role="img"
        aria-label={t('A QR code that opens the invite')}
      >
        {/* Scanners want a light field around the symbol; the page behind it is any colour. */}
        <rect x="0" y="0" width="100%" height="100%" fill="#fff" />
        <path d={drawing.path} fill="#000" />
      </svg>
      <p className="hint">{t('They scan this and the code is filled in for them.')}</p>
      {/* Not everyone can scan: no camera, or a screen reader. The link itself
          is readable and selectable, so the code can always be copied by hand. */}
      <p className="qr-link" dir="ltr">
        {drawing.link}
      </p>
      <div className="invite-actions">
        <button type="button" className="btn btn-outline btn-small" onClick={() => void copyLink()}>
          {copied ? t('Link copied') : t('Copy link')}
        </button>
      </div>
    </div>
  );
}
