/**
 * Read-only view of the student's standing class times, on the guardian's
 * side. The blocks are locked by design: a guardian can see and plan around
 * them, never edit them. When a lesson being written overlaps one, the warning
 * names the class so the clash can be fixed before the plan is sent.
 */
import { addDays, displayTime, weekdayIndex, formatWeekdayShort } from '../dates';
import { t } from '../i18n';
import { LockIcon } from '../icons';
import { classConflicts, classConflictsForDate, classesForWeekday } from '../fixedClasses';
import type { FixedClass } from '../types';

/** Locked class blocks for one weekday, smallest first. */
export function FixedClassChips({ classes, weekday }: { classes: FixedClass[]; weekday: number }) {
  const dayClasses = classesForWeekday(classes, weekday);
  if (dayClasses.length === 0) return null;
  return (
    <div className="fixed-class-chips" role="group" aria-label={t('Fixed classes this day')}>
      {dayClasses.map((item) => (
        <span key={item.id} className="fixed-class-chip" title={t('Fixed class — cannot be changed')}>
          <LockIcon size={11} />
          <span className="fixed-class-chip-time" dir="ltr">
            {displayTime(item.startTime)}–{displayTime(item.endTime)}
          </span>
          <span className="fixed-class-chip-name">{item.title}</span>
        </span>
      ))}
    </div>
  );
}

/** The whole week's locked timetable, grouped by weekday in app order. */
export function FixedClassWeek({ classes, weekdays }: { classes: FixedClass[]; weekdays: number[] }) {
  if (classes.length === 0) return null;
  return (
    <div className="fixed-class-week">
      <p className="chart-title">
        <LockIcon size={13} /> {t('Their fixed class times')}
      </p>
      <p className="hint">{t('Permanent classes set by the student. They cannot be moved — plan study around them.')}</p>
      <div className="fixed-class-week-grid">
        {weekdays.map((weekday) => {
          const dayClasses = classesForWeekday(classes, weekday);
          if (dayClasses.length === 0) return null;
          return (
            <div key={weekday} className="fixed-class-week-day">
              <p className="fixed-class-week-name">{weekdayShortLabel(weekday)}</p>
              {dayClasses.map((item) => (
                <p key={item.id} className="fixed-class-week-item">
                  <span dir="ltr">{displayTime(item.startTime)}–{displayTime(item.endTime)}</span>
                  <span>{item.title}</span>
                </p>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A clash warning for one lesson being planned. Empty when there is no fixed
 * class at that time, or when no start time has been chosen yet.
 */
export function FixedClassWarning({
  classes,
  isoDate,
  time,
  end,
}: {
  classes: FixedClass[];
  isoDate: string | null;
  time: string | null | undefined;
  end: string | null | undefined;
}) {
  const clashes = classConflictsForDate(classes, isoDate, time, end);
  if (clashes.length === 0) return null;
  return (
    <p className="fixed-class-warning" role="note">
      {t('Overlaps {0} ({1}–{2})', {
        0: clashes.map((item) => item.title).join(', '),
        1: displayTime(clashes[0]!.startTime),
        2: displayTime(clashes[0]!.endTime),
      })}
    </p>
  );
}

/** Short weekday label from a number (0 = Sunday), via a known-Sunday anchor. */
const SUNDAY_ANCHOR = '2023-01-01';
export function weekdayShortLabel(weekday: number): string {
  return formatWeekdayShort(addDays(SUNDAY_ANCHOR, ((weekday % 7) + 7) % 7));
}

/** Conflict check keyed by weekday rather than an ISO date, for draft days. */
export function FixedClassWeekdayWarning({
  classes,
  weekday,
  time,
  end,
}: {
  classes: FixedClass[];
  weekday: number;
  time: string | null | undefined;
  end: string | null | undefined;
}) {
  const clashes = classConflicts(classes, weekday, time, end);
  if (clashes.length === 0) return null;
  return (
    <p className="fixed-class-warning" role="note">
      {t('Overlaps {0} ({1}–{2})', {
        0: clashes.map((item) => item.title).join(', '),
        1: displayTime(clashes[0]!.startTime),
        2: displayTime(clashes[0]!.endTime),
      })}
    </p>
  );
}

/** Weekday index for an offset inside a plan starting on `startIso`. */
export function weekdayOfOffset(startIso: string, offset: number): number {
  const date = new Date(`${startIso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return weekdayIndex(date.toISOString().slice(0, 10));
}
