import { ACCENT_CHOICES, type Accent } from '../constants';
import { usePlanner } from '../context';
import { cx } from '../cx';
import { useImportFile } from '../hooks';
import { DownloadIcon, SparklesIcon, UploadIcon } from '../icons';
import { Modal } from './ui';

export function SettingsSheet() {
  const planner = usePlanner();
  const {
    settingsOpen,
    closeSettings,
    themeMode,
    setThemeMode,
    accent,
    setAccent,
    exportData,
    importText,
    loadSample,
    startFresh,
    requestConfirm,
  } = planner;
  const importFile = useImportFile(importText);
  if (!settingsOpen) return null;

  return (
    <Modal title="Settings" onClose={closeSettings} className="sheet-settings">
      <section className="set-section">
        <h3 className="kicker">Appearance</h3>
        <div className="set-row">
          <div>
            <p className="set-label">Theme</p>
            <p className="set-hint">Follows your device when set to System.</p>
          </div>
          <div className="segmented" role="radiogroup" aria-label="Theme">
            {(['system', 'light', 'dark'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={themeMode === mode}
                className={cx('seg', themeMode === mode && 'on')}
                onClick={() => setThemeMode(mode)}
              >
                {mode === 'system' ? 'System' : mode === 'light' ? 'Light' : 'Dark'}
              </button>
            ))}
          </div>
        </div>
        <div className="set-row">
          <div>
            <p className="set-label">Accent</p>
            <p className="set-hint">Used for highlights and progress.</p>
          </div>
          <div className="swatches" role="radiogroup" aria-label="Accent colour">
            {ACCENT_CHOICES.map((choice) => (
              <button
                key={choice.id}
                type="button"
                className={cx('swatch', `accent-${choice.id}`, accent === choice.id && 'on')}
                aria-label={choice.label}
                aria-checked={accent === (choice.id as Accent)}
                role="radio"
                onClick={() => setAccent(choice.id)}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="set-section">
        <h3 className="kicker">Your data</h3>
        <p className="set-hint">Everything stays in this browser. No account, no server.</p>
        <div className="set-actions">
          <button type="button" className="btn btn-soft" onClick={exportData}>
            <DownloadIcon size={16} /> Export backup
          </button>
          <button type="button" className="btn btn-soft" onClick={importFile.open}>
            <UploadIcon size={16} /> Import backup
          </button>
          <button type="button" className="btn btn-soft" onClick={loadSample}>
            <SparklesIcon size={16} /> Load sample day
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() =>
              requestConfirm({
                title: 'Start fresh?',
                body: 'This clears the planner in this browser. Export a backup first if you might want the old data.',
                confirmLabel: 'Start fresh',
                onConfirm: startFresh,
              })
            }
          >
            Start fresh
          </button>
        </div>
        <input ref={importFile.ref} className="visually-hidden" tabIndex={-1} aria-hidden="true" type="file" accept="application/json,.json" onChange={importFile.onChange} />
      </section>

      <section className="set-section">
        <h3 className="kicker">Shortcuts</h3>
        <ul className="shortcut-list">
          <li><span>Search &amp; quick add</span><span><kbd className="kbd">⌘</kbd><kbd className="kbd">K</kbd></span></li>
          <li><span>New task</span><span><kbd className="kbd">N</kbd></span></li>
          <li><span>Go to Today</span><span><kbd className="kbd">T</kbd></span></li>
          <li><span>Undo / redo</span><span><kbd className="kbd">⌘</kbd><kbd className="kbd">Z</kbd></span></li>
          <li><span>Close anything</span><span><kbd className="kbd">esc</kbd></span></li>
        </ul>
      </section>

      <p className="set-foot">Personal Planner · local-first · made for calm days</p>
    </Modal>
  );
}
