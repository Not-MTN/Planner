import { usePlanner } from '../context';
import { t } from '../i18n';

export function RealtimeIndicator({ compact = false }: { compact?: boolean }) {
  const { realtimeStatus, realtimeLive } = usePlanner();
  const label =
    realtimeStatus === 'live' ? t('Live — every part syncs instantly')
      : realtimeStatus === 'polling' ? t('Connecting… live in a moment')
        : realtimeStatus === 'offline' ? t('Offline — will sync when back online')
          : t('Reconnecting…');

  if (compact) {
    return (
      <span
        title={label}
        aria-label={label}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 12,
          opacity: 0.85,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: realtimeLive ? '#16a34a' : realtimeStatus === 'polling' ? '#f59e0b' : '#9ca3af',
            boxShadow: realtimeLive ? '0 0 0 4px rgba(22,163,74,.18)' : undefined,
            display: 'inline-block',
          }}
        />
        {realtimeLive ? 'Live' : realtimeStatus === 'polling' ? 'Syncing' : realtimeStatus}
      </span>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 13,
        padding: '6px 10px',
        borderRadius: 8,
        background: realtimeLive ? 'rgba(22,163,74,.08)' : 'rgba(0,0,0,.04)',
        border: `1px solid ${realtimeLive ? 'rgba(22,163,74,.22)' : 'rgba(0,0,0,.08)'}`,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 9,
          height: 9,
          borderRadius: 999,
          background: realtimeLive ? '#16a34a' : '#f59e0b',
          boxShadow: realtimeLive ? '0 0 0 4px rgba(22,163,74,.18)' : undefined,
          animation: realtimeLive ? 'pulse-live 1.6s infinite' : undefined,
        }}
      />
      <span style={{ fontWeight: 600 }}>{realtimeLive ? 'Neon Realtime • Live' : 'Neon Realtime • ' + realtimeStatus}</span>
      <span style={{ opacity: 0.7 }}>{label}</span>
      <style>{`@keyframes pulse-live{0%,100%{opacity:1}50%{opacity:.55}}`}</style>
    </div>
  );
}
