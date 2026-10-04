/**
 * Small SVG charts for the guardian panel.
 *
 * Everything here is drawn from weekly results — counts, minutes, and the
 * student's own words. There is no task title, no note, no reason beyond the
 * headline, because that is all a guardian ever receives.
 *
 * No charting library: these are a few dozen lines of SVG each, they inherit
 * the app's colours, and they work without JavaScript-driven layout.
 */
import { cx } from '../cx';
import { faDigits, faNum, t } from '../i18n';
import type { WeekResults } from '../types';

/** Monday, shortened: "28 Sep". */
function shortWeek(weekOf: string): string {
  const date = new Date(`${weekOf}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return weekOf.slice(5);
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function minutesLabel(minutes: number): string {
  const label = minutes < 60
    ? `${minutes}m`
    : `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`;
  return faDigits(label);
}

interface BarsProps {
  weeks: WeekResults[];
  height?: number;
}

/** Planned against done, week by week. The one chart that shows effort. */
export function WeekBars({ weeks, height = 150 }: BarsProps) {
  if (weeks.length === 0) return null;
  const ordered = [...weeks].sort((a, b) => a.weekOf.localeCompare(b.weekOf)); // oldest first
  const max = Math.max(1, ...ordered.map((week) => Math.max(week.planned, week.done)));
  const width = 320;
  const barWidth = Math.max(8, (width / ordered.length) * 0.34);
  const gap = (width / ordered.length) * 0.16;
  const scale = (value: number) => (value / max) * (height - 26);

  return (
    <div className="chart">
      {/* A key, not decoration: two bar colours and no words is a puzzle. */}
      <ul className="chart-legend">
        <li><span className="chart-key chart-key-planned" />{t('Planned')}</li>
        <li><span className="chart-key chart-key-done" />{t('Done')}</li>
      </ul>
      <svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t('Weekly planned and completed items')} preserveAspectRatio="none">
        {[0, 0.5, 1].map((line) => (
          <line
            key={line}
            className="chart-grid-lines"
            x1={0}
            x2={width}
            y1={12 + (height - 26) * line}
            y2={12 + (height - 26) * line}
          />
        ))}
        {ordered.map((week, index) => {
          const left = index * (width / ordered.length) + gap;
          const planned = scale(week.planned);
          const done = scale(week.done);
          return (
            <g key={week.weekOf}>
              <rect className="chart-bar-planned" x={left} y={12 + (height - 26) - planned} width={barWidth} height={Math.max(0, planned)} rx={3} />
              <rect className="chart-bar-done" x={left + barWidth + 2} y={12 + (height - 26) - done} width={barWidth} height={Math.max(0, done)} rx={3} />
            </g>
          );
        })}
      </svg>
      <div className="chart-axis">
        {ordered.map((week) => (
          <span key={week.weekOf}>{shortWeek(week.weekOf)}</span>
        ))}
      </div>
    </div>
  );
}

/**
 * Focused minutes per subject, across the weeks on record.
 *
 * The per-week split only says where last week's time went. This says whether
 * a subject is being looked after or quietly dropped — which is the question
 * behind "how is she doing in maths, really?". A single week cannot answer it,
 * because one bad week is noise and three in a row is a signal.
 */
export function SubjectTrend({ weeks, height = 34 }: BarsProps & { height?: number }) {
  if (weeks.length === 0) return null;
  const ordered = [...weeks].sort((a, b) => a.weekOf.localeCompare(b.weekOf));
  // Subjects that took real time at some point, most time first. Anything that
  // never got a minute is not a trend worth charting.
  const totals = new Map<string, number>();
  for (const week of ordered) {
    for (const subject of week.subjects) {
      totals.set(subject.name, (totals.get(subject.name) ?? 0) + subject.minutes);
    }
  }
  const names = [...totals.entries()]
    .filter(([, minutes]) => minutes > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([name]) => name);
  if (names.length === 0) return null;

  const width = 110;
  const max = Math.max(1, ...names.map((name) => Math.max(
    ...ordered.map((week) => week.subjects.find((item) => item.name === name)?.minutes ?? 0),
  )));
  const step = ordered.length > 1 ? width / (ordered.length - 1) : 0;
  const x = (index: number) => (ordered.length > 1 ? index * step : width / 2);
  const y = (minutes: number) => height - 2 - (minutes / max) * (height - 6);

  return (
    <ul className="subject-trend">
      {names.map((name, nameIndex) => {
        const minutes = ordered.map((week) => week.subjects.find((item) => item.name === name)?.minutes ?? 0);
        const line = minutes.map((value, index) => `${x(index)},${y(value)}`).join(' ');
        const last = minutes[minutes.length - 1] ?? 0;
        const before = minutes[minutes.length - 2] ?? null;
        // Direction over the whole stretch, not the last wobble: one quiet
        // week is a blip, and saying "down" about it would be alarm, not news.
        const firstHalf = minutes.slice(0, Math.floor(minutes.length / 2) || 1);
        const secondHalf = minutes.slice(Math.floor(minutes.length / 2) || 1);
        const average = (list: number[]) => (list.length ? list.reduce((sum, item) => sum + item, 0) / list.length : 0);
        const rising = average(secondHalf) > average(firstHalf) * 1.15;
        const falling = average(secondHalf) < average(firstHalf) * 0.85;
        return (
          <li key={name}>
            <div className="subject-trend-head">
              <span className="subject-trend-name">{name}</span>
              <span className="subject-trend-value">
                {minutesLabel(last)}
                {before !== null && last !== before ? (
                  <em className={rising ? 'subject-trend-up' : falling ? 'subject-trend-down' : undefined}>
                    {last > before ? '▲' : '▼'}
                  </em>
                ) : null}
              </span>
            </div>
            <svg
              className="subject-trend-svg"
              viewBox={`0 0 ${width} ${height}`}
              role="img"
              preserveAspectRatio="none"
              aria-label={t('{0}: {1} this week, across the last {2} weeks', { 0: name, 1: minutesLabel(last), 2: ordered.length })}
            >
              {minutes.length > 1 ? (
                <polyline className={`subject-trend-line subject-trend-line-${nameIndex % 4}`} points={line} />
              ) : null}
              {minutes.map((value, index) => (
                <circle key={index} className={`subject-trend-dot subject-trend-line-${nameIndex % 4}`} cx={x(index)} cy={y(value)} r="2.6">
                  <title>{`${shortWeek(ordered[index]!.weekOf)}: ${minutesLabel(value)}`}</title>
                </circle>
              ))}
            </svg>
          </li>
        );
      })}
    </ul>
  );
}

/** Focused minutes per week, as a line. The trend matters more than the exact values. */
export function FocusTrend({ weeks, height = 130 }: BarsProps) {
  if (weeks.length === 0) return null;
  const ordered = [...weeks].sort((a, b) => a.weekOf.localeCompare(b.weekOf));
  const width = 320;
  const max = Math.max(60, ...ordered.map((week) => week.focusMinutes));
  const points = ordered.map((week, index) => {
    const x = ordered.length === 1 ? width / 2 : (index / (ordered.length - 1)) * (width - 20) + 10;
    const y = height - 20 - (week.focusMinutes / max) * (height - 40);
    return { x, y, week };
  });
  const line = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  const area = `${line} ${points[points.length - 1]!.x.toFixed(1)},${height - 20} ${points[0]!.x.toFixed(1)},${height - 20}`;

  return (
    <div className="chart">
      <svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t('Weekly focused time')} preserveAspectRatio="none">
        <polygon className="chart-area" points={area} />
        <polyline className="chart-line" points={line} />
        {points.map((point) => (
          <circle key={point.week.weekOf} className="chart-dot" cx={point.x} cy={point.y} r={3.5} />
        ))}
        <text className="chart-max" x={6} y={14}>
          {minutesLabel(max)}
        </text>
      </svg>
      <div className="chart-axis">
        {ordered.map((week) => (
          <span key={week.weekOf}>{shortWeek(week.weekOf)}</span>
        ))}
      </div>
    </div>
  );
}

interface RingProps {
  done: number;
  planned: number;
}

/** How much of what they planned actually got done, this week. */
export function CompletionRing({ done, planned }: RingProps) {
  const total = Math.max(planned, done, 1);
  const ratio = Math.min(1, done / total);
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="completion-ring" role="img" aria-label={t('Completion: {0} of {1} planned items', { 0: done, 1: planned })}>
      <svg viewBox="0 0 100 100" className="completion-ring-svg">
        <circle className="completion-ring-track" cx={50} cy={50} r={radius} />
        <circle
          className="completion-ring-value"
          cx={50}
          cy={50}
          r={radius}
          strokeDasharray={`${circumference * ratio} ${circumference}`}
        />
      </svg>
      <div className="completion-ring-label">
        <strong>{faNum(Math.round(ratio * 100))}%</strong>
        <span>
          {faNum(done)}/{faNum(planned)}
        </span>
      </div>
    </div>
  );
}

interface SplitProps {
  subjects: Array<{ name: string; minutes: number }>;
}

/** Where the focused minutes went, by subject. Totals only. */
export function SubjectSplit({ subjects }: SplitProps) {
  if (subjects.length === 0) return null;
  const total = Math.max(1, subjects.reduce((sum, item) => sum + item.minutes, 0));
  return (
    <ul className="split">
      {subjects.map((subject, index) => (
        <li key={subject.name}>
          <div className="split-head">
            <span className="split-name">{subject.name}</span>
            <span className="split-value">{minutesLabel(subject.minutes)}</span>
          </div>
          <div className="split-track">
            <span className={cx('split-fill', `split-fill-${index % 4}`)} style={{ width: `${(subject.minutes / total) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export { shortWeek, minutesLabel };
