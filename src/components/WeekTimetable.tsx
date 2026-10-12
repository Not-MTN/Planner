/**
 * The week as a grid: days across, times down.
 *
 * The same lessons as the day rows, rearranged for seeing the shape of the
 * week at once. Tucked into a disclosure so the day rows stay the default
 * read — the grid is for the glance, and for the wall once printed.
 */
import { cx } from '../cx';
import { displayTime, formatMonthShort, formatWeekdayShort, todayISO } from '../dates';
import { faNum, t } from '../i18n';
import type { DayReport, GuardianPlan } from '../types';
import { timetableModel } from '../weekPlans';

export function WeekTimetable({
  plan,
  reports,
  hidePast = false,
  today = todayISO(),
}: {
  plan: GuardianPlan;
  reports: DayReport[];
  hidePast?: boolean;
  today?: string;
}) {
  const visiblePlan = hidePast ? { ...plan, items: plan.items.filter((item) => !item.date || item.date >= today) } : plan;
  const grid = timetableModel(visiblePlan, reports);
  if (grid.days.length === 0) return null;
  const showUntimed = grid.days.some((date) => grid.lessonsFor(date, null).length > 0);
  return (
    <details className="week-grid-wrap">
      <summary>{t('Timetable')}</summary>
      <div className="week-grid-scroll">
        <table className="week-grid">
          <thead>
            <tr>
              <th scope="col">{t('Time')}</th>
              {grid.days.map((date) => (
                <th key={date} scope="col">
                  <span className="week-grid-day">{formatWeekdayShort(date)}</span>
                  <span className="week-grid-date">
                    {faNum(Number(date.slice(8, 10)))} {formatMonthShort(date)}
                  </span>
                  {grid.reported(date) ? (
                    <span className="week-grid-mark reported">✓</span>
                  ) : grid.rest(date) ? (
                    <span className="week-grid-mark rest">{t('Rest day')}</span>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.times.map((time) => (
              <tr key={time}>
                <th scope="row">{displayTime(time)}</th>
                {grid.days.map((date) => (
                  <td key={date}>
                    {grid.lessonsFor(date, time).map((lesson) => (
                      <span key={lesson.id} className={cx('week-grid-lesson', lesson.done && 'done')}>
                        {lesson.title}
                      </span>
                    ))}
                  </td>
                ))}
              </tr>
            ))}
            {showUntimed ? (
              <tr>
                <th scope="row">{t('Any time')}</th>
                {grid.days.map((date) => (
                  <td key={date}>
                    {grid.lessonsFor(date, null).map((lesson) => (
                      <span key={lesson.id} className={cx('week-grid-lesson', lesson.done && 'done')}>
                        {lesson.title}
                      </span>
                    ))}
                  </td>
                ))}
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </details>
  );
}
