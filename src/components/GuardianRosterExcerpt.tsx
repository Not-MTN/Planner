import { faNum, t } from '../i18n';
import { chatFor } from '../chat';
import { formatEdited } from '../dates';
import type { GuardianLink, Panels } from '../types';

export function chatSnippet(panels: Panels, linkId: string | null): { text: string; at: string; from: string } | null {
  if (!linkId) return null;
  const thread = chatFor(panels.guardian.chat, linkId);
  const last = thread.at(-1);
  if (!last) return null;
  return { text: last.text, at: last.createdAt, from: last.from };
}

export function InviteExpiryCountdown({ expiresAt }: { expiresAt: string | null }) {
  if (!expiresAt) return <span className="hint">{t('Works until they use it')}</span>;
  const at = Date.parse(expiresAt);
  if (!Number.isFinite(at)) return null;
  const diff = at - Date.now();
  const days = Math.ceil(diff / 86_400_000);
  if (days <= 0) return <span className="roster-expiry is-expired">{t('Expired — send a new code')}</span>;
  if (days === 1) return <span className="roster-expiry is-soon">{t('Expires tomorrow')}</span>;
  if (days <= 3) return <span className="roster-expiry is-soon">{t('Expires in {0} days', { 0: faNum(days) })}</span>;
  return <span className="roster-expiry">{t('Expires in {0} days', { 0: faNum(days) })}</span>;
}

export function LastMessagePreview({ link, panels }: { link: GuardianLink; panels: Panels }) {
  const snippet = chatSnippet(panels, link.linkId);
  if (!snippet) return null;
  return (
    <p className="roster-chat-snippet" aria-label={t('Last message')}>
      <span className="roster-chat-author">{snippet.from === 'student' ? link.displayName : t('You')}:</span>{' '}
      <span className="roster-chat-text">{snippet.text.slice(0, 80)}{snippet.text.length > 80 ? '…' : ''}</span>
      <span className="roster-chat-at"> · {formatEdited(snippet.at)}</span>
    </p>
  );
}
