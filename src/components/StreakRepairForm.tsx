/**
 * The week's one mulligan: a short reason that files a missed day as kept.
 *
 * Kept is not done — the day counts as reported, so the panel unlocks and the
 * streak survives, but both sides read it as forgiven. The guardian sees the
 * reason with the week's other reports.
 */
import { useState } from 'react';
import { t } from '../i18n';

export function StreakRepairForm({
  onSave,
  onCancel,
}: {
  /** File the repair. Resolves when the day is kept. */
  onSave: (reason: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (saving || !reason.trim()) return;
    setSaving(true);
    try {
      await onSave(reason);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="week-repair-form">
      <input
        className="input"
        value={reason}
        maxLength={140}
        disabled={saving}
        placeholder={t('What happened?')}
        aria-label={t('What happened?')}
        onChange={(event) => setReason(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && reason.trim()) {
            event.preventDefault();
            void save();
          }
        }}
      />
      <div className="week-repair-actions">
        <button
          type="button"
          className="btn btn-primary btn-small"
          disabled={saving || !reason.trim()}
          onClick={() => void save()}
        >
          {t('Save')}
        </button>
        <button type="button" className="btn btn-ghost btn-small" disabled={saving} onClick={onCancel}>
          {t('Cancel')}
        </button>
      </div>
      <p className="hint">{t('One per week — for the day that truly got away.')}</p>
    </div>
  );
}
