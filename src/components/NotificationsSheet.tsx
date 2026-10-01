import type { PlannerNotification } from '../notificationCenter';
import { BellIcon, CheckIcon, StopwatchIcon } from '../icons';
import { t } from '../i18n';
import { SNOOZE_CHOICES } from '../reminders';
import { Modal } from './ui';

export function NotificationsSheet({
  items,
  onClose,
  onOpenToday,
  onMarkAllRead,
  onClear,
  onRead,
  onSnooze,
}: {
  items: PlannerNotification[];
  onClose: () => void;
  onOpenToday: () => void;
  onMarkAllRead: () => void;
  onClear: () => void;
  onRead: (key: string) => void;
  onSnooze: (key: string, minutes: number) => void;
}) {
  const unread = items.filter((item) => !item.read).length;
  return (
    <Modal title={t('Notifications')} onClose={onClose} className="notifications-sheet">
      <div className="notification-toolbar">
        <span className="meta" aria-live="polite">
          {unread > 0 ? t('{0} unread', { 0: unread }) : t('You’re all caught up.')}
        </span>
        <div className="set-actions">
          {unread > 0 ? <button type="button" className="btn btn-tiny" onClick={onMarkAllRead}>{t('Mark all read')}</button> : null}
          {items.length > 0 ? <button type="button" className="btn btn-tiny btn-ghost" onClick={onClear}>{t('Clear notifications')}</button> : null}
        </div>
      </div>
      {items.length === 0 ? (
        <div className="notification-empty">
          <span className="notification-empty-icon"><BellIcon size={22} /></span>
          <h3>{t('No notifications yet')}</h3>
          <p>{t('Reminders will show up here so you can come back to them.')}</p>
        </div>
      ) : (
        <ul className="notification-list" aria-label={t('Notifications')}>
          {items.map((item) => (
            <li key={item.key} className={!item.read ? 'is-unread' : undefined}>
              <button type="button" className="notification-item" onClick={() => { onRead(item.key); onOpenToday(); }}>
                <span className="notification-icon"><BellIcon size={17} /></span>
                <span className="notification-copy">
                  <strong>{item.title}</strong>
                  <span>{item.body}</span>
                  <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time>
                </span>
                {!item.read ? <i className="notification-dot" aria-label={t('Unread')} /> : <CheckIcon size={15} />}
              </button>
              <div className="notification-snooze" role="group" aria-label={t('Snooze {0}', { 0: item.title })}>
                <StopwatchIcon size={13} />
                {SNOOZE_CHOICES.map((minutes) => (
                  <button
                    key={minutes}
                    type="button"
                    className="btn btn-tiny btn-ghost"
                    onClick={() => onSnooze(item.key, minutes)}
                  >
                    {t('{0} min', { 0: minutes })}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
