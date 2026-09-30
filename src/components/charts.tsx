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
import { t } from '../i18n';
import type { WeekResults } from '../types';

/** Monday, shortened: "28 Sep". */
function shortWeek(weekOf: string): string {
  const date = new Date(`${weekOf}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return weekOf.slice(5);
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function minutesLabel(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`;
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
      <div className="chart-legend">
        <span className="chart-key chart-key-planned">{/* label comes from the caller */}</span>
      </div>
      <svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t('Weekly planned and completed items')} preserveAspectRatio="none">
        {[0, 0.5, 1].map((line) => (
          <line
            key={line}
            className="chart-grid"
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
        <strong>{Math.round(ratio * 100)}%</strong>
        <span>
          {done}/{planned}
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
