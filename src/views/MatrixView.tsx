import { useMemo } from 'react';
import { t } from '../i18n';
import type { Task } from '../types';
import { TaskRow } from '../components/items';

type Props = {
  tasks: Task[];
};

function quadrant(task: Task): 'q1' | 'q2' | 'q3' | 'q4' {
  const today = new Date().toISOString().slice(0, 10);
  const urgent = task.dueDate ? task.dueDate <= today : false;
  const important = task.priority === 'high';
  if (urgent && important) return 'q1';
  if (!urgent && important) return 'q2';
  if (urgent && !important) return 'q3';
  return 'q4';
}

const QUADRANTS = [
  { key: 'q1' as const, title: 'Do', subtitle: 'Urgent & Important', color: 'var(--danger)', icon: '🔥' },
  { key: 'q2' as const, title: 'Schedule', subtitle: 'Not urgent & Important', color: 'var(--accent)', icon: '🎯' },
  { key: 'q3' as const, title: 'Delegate', subtitle: 'Urgent & Not important', color: 'var(--warning)', icon: '⚡' },
  { key: 'q4' as const, title: 'Eliminate', subtitle: 'Not urgent & Not important', color: 'var(--muted)', icon: '🍃' },
];

export function MatrixView({ tasks }: Props) {
  const groups = useMemo(() => {
    const g: Record<string, Task[]> = { q1: [], q2: [], q3: [], q4: [] };
    for (const task of tasks.filter((t) => !t.completed)) {
      g[quadrant(task)].push(task);
    }
    return g;
  }, [tasks]);

  return (
    <div className="view matrix-view">
      <div className="view-head">
        <div>
          <h1 className="page-title">{t('Eisenhower Matrix')}</h1>
          <p className="lede">{t('Prioritize by urgency and importance. Focus on what truly matters.')}</p>
        </div>
      </div>

      <div className="matrix-grid">
        {QUADRANTS.map((q) => (
          <div key={q.key} className="matrix-card" style={{ ['--quad-color' as string]: q.color }}>
            <div className="matrix-card-head">
              <span className="matrix-icon" aria-hidden="true">{q.icon}</span>
              <div>
                <h3 className="matrix-title">{t(q.title)}</h3>
                <p className="matrix-sub">{t(q.subtitle)}</p>
              </div>
              <span className="matrix-count">{groups[q.key].length}</span>
            </div>
            <div className="matrix-list">
              {groups[q.key].length === 0 ? (
                <p className="empty matrix-empty">{t('Nothing here — clear mind!')}</p>
              ) : (
                <ul className="item-list">
                  {groups[q.key].map((task) => (
                    <TaskRow key={task.id} task={task} />
                  ))}
                </ul>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
