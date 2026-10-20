import { useEffect, useState } from 'react';
import { debugEnabled } from '../debug/panelSync';
import { usePlanner } from '../context';

export function PanelDebugInspector({ side }: { side: 'guardian' | 'student' }) {
  const { panels } = usePlanner();
  const [on, setOn] = useState(false);
  useEffect(() => setOn(debugEnabled()), []);
  if (!on) return null;
  const g = panels.guardian;
  const s = panels.student;
  const data = side === 'guardian'
    ? {
        links: g.links.length,
        notices: g.notices.length,
        chat: (g.chat ?? []).length,
        queued: g.queuedPlans?.length ?? 0,
        lastChat: (g.chat ?? []).at(-1)?.createdAt?.slice(11,16) ?? '—',
      }
    : {
        inboxPlans: s.inbox.plans.length,
        inboxNotices: s.inbox.notices.length,
        chat: (s.chat ?? []).length,
        reports: s.reports?.length ?? 0,
        lastInbox: s.inbox.notices.at(-1)?.createdAt?.slice(11,16) ?? '—',
      };
  return (
    <div className="panel-debug" role="status" aria-label="Panel debug">
      <strong>Debug · {side}</strong> · {Object.entries(data).map(([k,v]) => `${k}=${v}`).join(' · ')} · <span>?debug=sync to hide</span>
    </div>
  );
}
