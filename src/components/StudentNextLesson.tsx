import { useMemo } from 'react';
import { usePlanner } from '../context';
import { faNum, t } from '../i18n';
import { minutesLabel } from './charts';
import { todayISO } from '../dates';
import { withPlanItemToggled } from '../panels';
import type { GuardianPlan } from '../types';

interface NextLesson {
  plan: GuardianPlan;
  item: GuardianPlan['items'][number];
  date: string;
  minutes: number | null;
}

function nextLesson(plans: GuardianPlan[], completedPlanItemIds: Set<string>, _today: string): NextLesson | null {
  const candidates: NextLesson[] = [];
  for (const plan of plans) {
    for (const item of plan.items) {
      if (item.done) continue;
      if (completedPlanItemIds.has(item.id)) continue;
      // Prefer dated items; undated fallback last. Overdue (date < today) sorts first to surface quickly.
      candidates.push({ plan, item, date: item.date ?? plan.start, minutes: item.minutes ?? null });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const d = (a.date ?? '').localeCompare(b.date ?? '');
    if (d) return d;
    const ta = a.item.time ?? '99:99';
    const tb = b.item.time ?? '99:99';
    return ta.localeCompare(tb);
  });
  return candidates[0] ?? null;
}

export function StudentNextLesson({
  onRoll,
  canRoll,
}: {
  onRoll?: (planId: string, itemId: string) => void;
  canRoll?: boolean;
}) {
  const { panels, startFocus, updatePanels } = usePlanner();
  const today = todayISO();
  const plans = panels.student.inbox.plans;
  // completed ticks are stored on plan item done flag; also check reports? For sticky we just need next not-done.
  const candidate = useMemo(() => nextLesson(plans, new Set(), today), [plans, today]);
  if (!candidate) {
    return (
      <section className="card sticky-next-lesson is-empty" aria-label={t('Up next')}>
        <p className="kicker">{t('Up next')}</p>
        <p className="empty-note">{t('Nothing left for today — add a study task or enjoy the break.')}</p>
      </section>
    );
  }
  const { plan, item } = candidate;
  const timeLabel = item.time ? `${item.time}${item.end ? `–${item.end}` : ''}` : null;
  return (
    <section className="card sticky-next-lesson" aria-label={t('Up next')} style={{ position: 'sticky', top: 8, zIndex: 2 }}>
      <div className="sticky-next-head">
        <div>
          <p className="kicker">{t('Up next')} · {plan.title}</p>
          <h2 className="card-title sticky-next-title">{item.title}</h2>
          <p className="sticky-next-meta">
            {timeLabel ? <span>{timeLabel}</span> : null}
            {item.subject ? <span>{item.subject}</span> : null}
            {item.minutes ? <span>{minutesLabel(item.minutes)}</span> : null}
            {item.date ? <span>{item.date}</span> : null}
          </p>
        </div>
        <span className="sticky-next-badge">{faNum(1)} {t('left')}</span>
      </div>
      <div className="sticky-next-actions">
        <button
          type="button"
          className="btn btn-primary btn-small"
          onClick={() =>
            startFocus({ taskId: null, title: item.title, minutes: Math.min(60, item.minutes ?? 25) })
          }
        >
          {t('Start')} · {item.minutes ? minutesLabel(item.minutes) : t('Focus 25m')}
        </button>
        <button
          type="button"
          className="btn btn-outline btn-small"
          onClick={() => updatePanels((latest) => withPlanItemToggled(latest, plan.id, item.id))}
        >
          {t('Done ✓')}
        </button>
        {canRoll && onRoll ? (
          <button type="button" className="btn btn-ghost btn-small" onClick={() => onRoll(plan.id, item.id)}>
            {t('Push to next free day')}
          </button>
        ) : null}
      </div>
      <p className="hint">{t('Ticking here also updates your guardian’s view.')}</p>
    </section>
  );
}
