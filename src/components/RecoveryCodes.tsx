import { useEffect, useState } from 'react';
import { normalizeRecoveryKey } from '../auth/crypto';

/**
 * The list of recovery codes shown once, at the moment an account is created or
 * its codes are replaced.
 *
 * Two things make this more than a wall of text:
 *
 * - Every code is numbered and copyable on its own, so the set can be split up
 *   (one in a wallet, one with a parent) instead of living in a single file.
 * - Continuing requires typing one *named* code back. A bare "I saved it"
 *   checkbox is ticked without thinking; asking for code 5 of 8 is answered
 *   only by someone who really has the list in front of them.
 */
export function RecoveryCodes({
  codes,
  copy,
  onConfirmedChange,
  idPrefix,
  animationDelay = 60,
}: {
  codes: string[];
  copy: Record<string, string>;
  onConfirmedChange: (confirmed: boolean) => void;
  idPrefix: string;
  animationDelay?: number;
}) {
  const [copied, setCopied] = useState(false);
  const [entry, setEntry] = useState('');
  // Picked once, at random, so the answer cannot be prepared in advance.
  const [asked] = useState(() => Math.floor(Math.random() * Math.max(codes.length, 1)));
  const askedNumber = asked + 1;
  const askedCode = codes[asked] ?? '';
  const entered = normalizeRecoveryKey(entry);
  const matches = entered !== null && askedCode.length > 0 && entered === normalizeRecoveryKey(askedCode);

  useEffect(() => {
    onConfirmedChange(matches);
  }, [matches, onConfirmedChange]);

  const text = (template: string) => template.replace('{n}', String(askedNumber));
  const all = codes.map((code, index) => `${index + 1}. ${code}`).join('\n');

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(all);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  };

  const download = () => {
    const body = `Planner recovery codes\n\n${all}\n\n${copy.authRecoverySub}\n`;
    const url = URL.createObjectURL(new Blob([body], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'planner-recovery-codes.txt';
    link.click();
    URL.revokeObjectURL(url);
  };

  const print = () => {
    const win = window.open('', '_blank', 'noopener,noreferrer');
    if (!win) return;
    const rows = codes.map((code, index) => `<li><span>${index + 1}</span><code>${code}</code></li>`).join('');
    win.document.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>Planner recovery codes</title>` +
        `<style>` +
        `body{font-family:system-ui,sans-serif;padding:32px;color:#111}` +
        `h1{font-size:18px;margin:0 0 4px}p{margin:0 0 20px;font-size:13px;color:#555;max-width:46ch}` +
        `ol{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 24px}` +
        `li{display:flex;gap:10px;align-items:baseline;font-size:14px}` +
        `span{color:#888;min-width:1.5em}code{font-family:ui-monospace,monospace;letter-spacing:.06em}` +
        `</style></head><body><h1>Planner recovery codes</h1><p>${copy.authRecoverySub}</p><ol>${rows}</ol></body></html>`,
    );
    win.document.close();
    win.focus();
    win.print();
  };

  return (
    <>
      <div className="recovery reveal-in" style={{ animationDelay: `${animationDelay}ms` }}>
        <ol className="recovery-codes">
          {codes.map((code, index) => (
            <li key={code}>
              <span className="recovery-code-num">{index + 1}</span>
              <code dir="ltr">{code}</code>
            </li>
          ))}
        </ol>
        <div className="recovery-actions">
          <button type="button" className="btn btn-outline" onClick={() => void copyAll()}>
            {copied ? copy.authRecoveryCopied : copy.authRecoveryCopy}
          </button>
          <button type="button" className="btn btn-outline" onClick={download}>
            {copy.authRecoveryDownload}
          </button>
          <button type="button" className="btn btn-outline" onClick={print}>
            {copy.authRecoveryPrint}
          </button>
        </div>
        <p className="recovery-warn">{copy.authRecoveryWarn}</p>
      </div>

      <div className="field reveal-in" style={{ animationDelay: `${animationDelay + 50}ms` }}>
        <label htmlFor={`${idPrefix}-confirm`}>{text(copy.authRecoveryConfirmLabel)}</label>
        <input
          id={`${idPrefix}-confirm`}
          className="input"
          dir="ltr"
          value={entry}
          onChange={(event) => setEntry(event.target.value)}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder={`${askedNumber}. plnr-…`}
        />
        <p className="auth-hint">{text(copy.authRecoveryConfirmHint)}</p>
        {matches ? <p className="recovery-ok">{copy.authRecoveryConfirmOk}</p> : null}
        {entry.trim() && !matches ? <p className="auth-error">{text(copy.authRecoveryConfirmBad)}</p> : null}
      </div>
    </>
  );
}
