import { useEffect, useState } from 'react';
import { debugEnabled } from '../debug/panelSync';
import { usePlanner } from '../context';
import { formatInstantTime } from '../dates';

export function PanelDebugInspector({ side }: { side: 'guardian' | 'student' }) {
  const { panels } = usePlanner();
  const [on, setOn] = useState(false);
  useEffect(() => setOn(debugEnabled()), []);
  if (!on) return null;
  const g = panels.guardian;
  const s = panels.student;
  const lastTime = (iso: string | undefined) => (iso ? formatInstantTime(iso) : '—');
  const data = side === 'guardian'
    ? {
        links: g.links.length,
        notices: g.notices.length,
        chat: (g.chat ?? []).length,
        queued: g.queuedPlans?.length ?? 0,
        lastChat: lastTime((g.chat ?? []).at(-1)?.createdAt),
      }
    : {
        inboxPlans: s.inbox.plans.length,
        inboxNotices: s.inbox.notices.length,
        chat: (s.chat ?? []).length,
        reports: s.reports?.length ?? 0,
        lastInbox: lastTime(s.inbox.notices.at(-1)?.createdAt),
      };
  return (
    <div className="panel-debug" role="status" aria-label="Panel debug">
      <strong>Debug · {side}</strong> · {Object.entries(data).map(([k,v]) => `${k}=${v}`).join(' · ')} · <span>?debug=sync to hide</span>
    </div>
  );
}
