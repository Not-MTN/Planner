import type { PlannerNotification } from '../notificationCenter';
import { BellIcon, CalendarIcon, CheckIcon, LeafIcon, SunIcon, TickIcon, StopwatchIcon } from '../icons';
import { t } from '../i18n';
import { SNOOZE_CHOICES } from '../reminders';
import { Modal } from './ui';
import { formatStamp } from '../dates';

type NotificationKind = 'event' | 'task' | 'habit' | 'digest' | 'reminder';

export function notificationKind(key: string): NotificationKind {
  if (key.includes('|event|')) return 'event';
  if (key.includes('|task|')) return 'task';
  if (key.includes('|habit|')) return 'habit';
  if (key.endsWith('|digest')) return 'digest';
  return 'reminder';
}

function NotificationGlyph({ kind }: { kind: NotificationKind }) {
  if (kind === 'event') return <CalendarIcon size={18} />;
  if (kind === 'task') return <TickIcon size={18} />;
  if (kind === 'habit') return <LeafIcon size={18} />;
  if (kind === 'digest') return <SunIcon size={18} />;
  return <BellIcon size={18} />;
}

function kindLabel(kind: NotificationKind): string {
  if (kind === 'event') return t('Schedule');
  if (kind === 'task') return t('Task');
  if (kind === 'habit') return t('Habit');
  if (kind === 'digest') return t('Daily overview');
  return t('Reminder');
}

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
      <div className="notification-intro">
        <span className="notification-intro-icon" aria-hidden="true"><BellIcon size={22} /></span>
        <div>
          <strong>{unread > 0 ? t('A few gentle nudges') : t('Your day is clear')}</strong>
          <span aria-live="polite">
            {unread > 0 ? t('{0} unread', { 0: unread }) : t('You’re all caught up.')}
          </span>
        </div>
      </div>
      <div className="notification-toolbar">
        <span className="notification-toolbar-label">{t('Recent')}</span>
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
          {items.map((item) => {
            const kind = notificationKind(item.key);
            return (
              <li key={item.key} className={`notification-card tone-${kind}${!item.read ? ' is-unread' : ''}`}>
                <button type="button" className="notification-item" onClick={() => { onRead(item.key); onOpenToday(); }}>
                  <span className="notification-icon"><NotificationGlyph kind={kind} /></span>
                  <span className="notification-copy">
                    <span className="notification-kind">{kindLabel(kind)}</span>
                    <strong>{item.title}</strong>
                    <span>{item.body}</span>
                    <time dateTime={item.createdAt}>{formatStamp(item.createdAt)}</time>
                  </span>
                  {!item.read ? <i className="notification-dot" aria-label={t('Unread')} /> : <span className="notification-read"><CheckIcon size={15} /></span>}
                </button>
                <div className="notification-snooze" role="group" aria-label={t('Snooze {0}', { 0: item.title })}>
                  <span className="notification-snooze-label"><StopwatchIcon size={13} /> {t('Remind again')}</span>
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
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
