/**
 * Notifications, in one place.
 *
 * Until now a notice turned up wherever the panel happened to have room — three
 * at the top of the week, a request wedged above the results, praise mixed in
 * with the goals. Which meant the only way to be sure nothing was waiting was
 * to read every tab, and the only way to see what had already been dealt with
 * was to remember it.
 *
 * So this is the section they live in: everything that arrived, newest first,
 * grouped by what it is, with the unread ones at the top and a way to clear the
 * lot. The panels still surface the single most urgent thing where it is useful
 * — but the list of record is here.
 */
import { useState, type ReactNode } from 'react';
import { cx } from '../cx';
import { formatFullDate, formatStamp } from '../dates';
import { faNum, t } from '../i18n';
import { BellIcon, CheckIcon, HeartIcon, NoteIcon, SparkIcon } from '../icons';
import type { GuardianNotice } from '../types';
import { Empty } from './ui';

type Filter = 'all' | 'unread' | 'praise';

/** What a notice is, in the words the reader will recognise. */
function noticeLabel(notice: GuardianNotice): string {
  switch (notice.kind) {
    case 'praise':
      return t('Kind words');
    case 'request':
      return t('A request');
    case 'nudge':
      return t('A nudge');
    default:
      return t('A note');
  }
}

function NoticeIcon({ kind }: { kind: GuardianNotice['kind'] }) {
  if (kind === 'praise') return <HeartIcon size={14} />;
  if (kind === 'request') return <SparkIcon size={14} />;
  return <NoteIcon size={14} />;
}

export function PanelNotifications({
  notices,
  onMarkAllRead,
  onOpen,
  /** What the panel calls the people these notices are about. */
  othersLabel,
  /**
   * An action that belongs to one notice rather than to the list — answering a
   * request for a plan, for instance. Returning null leaves the row without one.
   */
  action,
}: {
  notices: GuardianNotice[];
  onMarkAllRead: () => void;
  /** Called with the student a notice concerns, so the panel can go to them. */
  onOpen?: (username: string) => void;
  othersLabel: string;
  action?: (notice: GuardianNotice) => ReactNode;
}) {
  const [filter, setFilter] = useState<Filter>('all');

  const unread = notices.filter((notice) => !notice.read).length;
  const praise = notices.filter((notice) => notice.kind === 'praise').length;
  const shown = notices
    .filter((notice) =>
      filter === 'unread' ? !notice.read : filter === 'praise' ? notice.kind === 'praise' : true,
    )
    // Unread first, then newest: what needs you before what you have seen.
    .sort((a, b) => Number(a.read) - Number(b.read) || b.createdAt.localeCompare(a.createdAt));

  return (
    <section className="card notifications" aria-label={t('Notifications')}>
      <div className="card-head">
        <h2 className="card-title">
          <BellIcon size={15} />
          {t('Notifications')}
        </h2>
        {unread > 0 ? (
          <button type="button" className="btn btn-ghost btn-small" onClick={onMarkAllRead}>
            <CheckIcon size={14} />
            {t('Mark all read')}
          </button>
        ) : null}
      </div>
      <p className="hint">
        {t('Everything that arrived from {0}, in one place.', { 0: othersLabel })}
      </p>

      <div className="notifications-filters" role="group" aria-label={t('Filter notifications')}>
        {(
          [
            ['all', t('All'), notices.length],
            ['unread', t('Unread'), unread],
            ['praise', t('Kind words'), praise],
          ] as Array<[Filter, string, number]>
        ).map(([id, label, count]) => (
          <button
            key={id}
            type="button"
            className={cx('btn btn-tiny', filter === id ? 'btn-primary' : 'btn-ghost')}
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
          >
            {label}
            {count > 0 ? <span className="notifications-count">{faNum(count)}</span> : null}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <Empty
          compact
          title={filter === 'unread' ? t('Nothing waiting') : t('No notifications yet')}
          text={
            filter === 'unread'
              ? t('Everything here has been read.')
              : t('Notes, requests and kind words land here as they arrive.')
          }
        />
      ) : (
        <ul className="notifications-list">
          {shown.map((notice, index) => {
            const previous = shown[index - 1];
            const newDay =
              !previous || previous.createdAt.slice(0, 10) !== notice.createdAt.slice(0, 10);
            return (
              <li key={notice.id}>
                {newDay ? (
                  <p className="notifications-day">{formatFullDate(notice.createdAt.slice(0, 10))}</p>
                ) : null}
                <div className={cx('notification', !notice.read && 'is-unread', notice.kind === 'praise' && 'is-praise')}>
                  <span className="notification-icon" aria-hidden="true">
                    <NoticeIcon kind={notice.kind} />
                  </span>
                  <div className="notification-body">
                    <p className="notification-kind">
                      {noticeLabel(notice)}
                      {notice.student ? <span>{notice.student}</span> : null}
                      {!notice.read ? <span className="notification-new">{t('New')}</span> : null}
                    </p>
                    <p className="notification-text">{notice.summary}</p>
                    <p className="notification-meta">{formatStamp(notice.createdAt)}</p>
                  </div>
                  <span className="notification-actions">
                    {action?.(notice)}
                    {onOpen && notice.student ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-tiny"
                        onClick={() => onOpen(notice.student)}
                      >
                        {t('Open')}
                      </button>
                    ) : null}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
