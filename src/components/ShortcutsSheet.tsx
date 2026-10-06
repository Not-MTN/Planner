import { useEffect } from 'react';
import { Modal } from './ui';
import { Rich } from '../components/Rich';
import { t } from '../i18n';

/**
 * Kept in step with the key handler in `Shell.tsx` by
 * `shortcutsSheet.test.ts`, which reads that handler and fails when a key it
 * answers is missing here — or when a description promises something else
 * (`?` said "Open settings" while it opened this sheet).
 */
const SHORTCUTS = [
  { keys: ['⌘', 'K'], desc: 'Open command palette' },
  { keys: ['/'], desc: 'Search or add' },
  { keys: ['N'], desc: 'New task' },
  { keys: ['T'], desc: 'Go to Today' },
  { keys: ['M'], desc: 'Go to Matrix' },
  { keys: ['R'], desc: 'Open weekly review' },
  { keys: ['?'], desc: 'Show these shortcuts' },
  { keys: ['⌘', 'Z'], desc: 'Undo' },
  { keys: ['⌘', '⇧', 'Z'], desc: 'Redo' },
  { keys: ['Esc'], desc: 'Close dialog' },
];

export function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <Modal title={t('Keyboard shortcuts')} onClose={onClose}>
      <div className="shortcuts-grid">
        {SHORTCUTS.map((s) => (
          <div key={s.desc} className="shortcut-row">
            <span className="shortcut-desc">{t(s.desc)}</span>
            <span className="shortcut-keys">
              {s.keys.map((k) => (
                <kbd key={k} className="kbd">{k}</kbd>
              ))}
            </span>
          </div>
        ))}
      </div>
      <div className="shortcuts-foot">
        <p className="meta">
      <Rich text={t('Tip: Press {key} anywhere to quickly add or search.')} values={{ key: <kbd className="kbd">/</kbd> }} />
    </p>
      </div>
    </Modal>
  );
}
