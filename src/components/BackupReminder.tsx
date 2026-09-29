import { useEffect, useState } from 'react';
import { t } from '../i18n';

const KEY = 'planner-last-backup';
const INTERVAL_DAYS = 7;

export function BackupReminder({ onExport }: { onExport: () => void }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      const last = localStorage.getItem(KEY);
      if (!last) {
        const hasData = localStorage.getItem('planner-state-v2') || localStorage.getItem('planner-state');
        if (hasData) setShow(true);
        return;
      }
      const days = (Date.now() - Number(last)) / 86400000;
      if (days > INTERVAL_DAYS) setShow(true);
    } catch {}
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch {}
    setShow(false);
  };

  const doExport = () => {
    onExport();
    dismiss();
  };

  if (!show) return null;

  return (
    <div className="card backup-reminder">
      <div className="backup-icon">💾</div>
      <div className="backup-copy">
        <strong>{t('Back up your planner?')}</strong>
        <p>{t('It’s been a while. Export a backup so you never lose your plans.')}</p>
      </div>
      <div className="backup-actions">
        <button className="btn btn-primary btn-small" onClick={doExport}>{t('Export')}</button>
        <button className="btn btn-ghost btn-small" onClick={dismiss}>{t('Later')}</button>
      </div>
    </div>
  );
}
