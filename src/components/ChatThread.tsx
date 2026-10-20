/**
 * The thread between a guardian and one student — now real-time with typing,
 * presence, read receipts and optimistic acks.
 *
 * One component, both sides. A message is written locally first and shown at
 * once, marked as on its way. If the send fails it stays, unsent, with retry.
 * Typing, presence and read receipts ride Neon Realtime link:typing/presence/read
 * (ephemeral, no DB bloat) while the message itself rides the encrypted link
 * outbox (link:note → panel sync).
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePlanner } from '../context';
import { cx } from '../cx';
import { formatFullDate, formatInstantTime } from '../dates';
import { faNum, t } from '../i18n';
import { ChatIcon } from '../icons';
import { sendChatMessage } from '../auth/links';
import {
  chatDays,
  chatFor,
  chatRoom,
  sanitizeChatMessage,
  unreadChatCount,
  withChatMessage,
  withChatSeen,
} from '../chat';
import { acquireSyncPriority } from '../syncPriority';
import { newId } from '../panels';
import { CHAT_TEXT_MAX } from '../types';
import type { ChatSide } from '../types';
import { Empty } from './ui';
import {
  getCurrentUserId,
  sendPresence,
  sendReadReceipt,
  sendTyping,
  subscribeRealtime,
} from '../auth/realtimeClient';

/** How close to the cap the counter starts showing */
const ROOM_WARNING = 80;

export function ChatThread({
  linkId,
  otherName,
  side,
}: {
  linkId: string;
  otherName: string;
  side: ChatSide;
}) {
  const { panels, updatePanels, flash, linkSyncStatus, realtimeStatus, runPanelSync, kickPanelSync } = usePlanner();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [waiting, setWaiting] = useState<string[]>([]);
  const [atEnd, setAtEnd] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // ----- polish state -----
  const [otherTyping, setOtherTyping] = useState(false);
  const [otherOnline, setOtherOnline] = useState(false);
  const [seenIds, setSeenIds] = useState<Set<string>>(() => new Set());
  const seenMeta = useRef<Map<string, string>>(new Map()); // id -> createdAt
  const typingTimeout = useRef<number | null>(null);
  const presenceTimeout = useRef<number | null>(null);
  const lastTypingSent = useRef(0);
  const presenceTimer = useRef<number | null>(null);

  useEffect(() => acquireSyncPriority('chat'), []);

  const held = side === 'student' ? panels.student.chat : panels.guardian.chat;
  const thread = chatFor(held, linkId);
  const days = chatDays(thread);
  const threadRef = useRef(thread);
  threadRef.current = thread;

  const jumpToEnd = useCallback((smooth: boolean) => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  // Mark read + send read receipt to other side (so they see ✓✓ blue)
  useEffect(() => {
    const latest = thread[thread.length - 1];
    if (!latest) return;
    const seen = side === 'student' ? panels.student.chatSeen : panels.guardian.chatSeen;
    if ((seen?.[linkId] ?? '') >= latest.createdAt) return;
    updatePanels((current) => withChatSeen(current, linkId, latest.createdAt, side));
    // If latest is from the other side, tell them we saw it
    if (latest.from !== side) {
      void sendReadReceipt(linkId, latest.id, latest.createdAt);
    }
  }, [linkId, thread, panels.student.chatSeen, panels.guardian.chatSeen, side, updatePanels]);

  // Presence heartbeat: every 15s while chat open + immediately
  useEffect(() => {
    if (!linkId) return;
    void sendPresence(linkId);
    presenceTimer.current = window.setInterval(() => void sendPresence(linkId), 15000) as unknown as number;
    return () => {
      if (presenceTimer.current !== null) window.clearInterval(presenceTimer.current);
    };
  }, [linkId]);

  // Subscribe to ephemeral link events: typing / presence / read
  useEffect(() => {
    if (!linkId) return;
    const myId = getCurrentUserId();
    const stop = subscribeRealtime(900, async (events) => {
      for (const e of events) {
        const p = e.payload as Record<string, unknown> | null;
        if (!p || typeof p.linkId !== 'string' || p.linkId !== linkId) continue;
        // Ignore own events (other device of same user typing should not show as other)
        if (p.from && myId && p.from === myId) continue;
        if (e.kind === 'link:typing') {
          const typing = Boolean(p.typing);
          setOtherTyping(typing);
          if (typing) {
            if (typingTimeout.current !== null) window.clearTimeout(typingTimeout.current);
            typingTimeout.current = window.setTimeout(() => setOtherTyping(false), 3500) as unknown as number;
          } else {
            if (typingTimeout.current !== null) window.clearTimeout(typingTimeout.current);
            setOtherTyping(false);
          }
        } else if (e.kind === 'link:presence') {
          setOtherOnline(true);
          if (presenceTimeout.current !== null) window.clearTimeout(presenceTimeout.current);
          presenceTimeout.current = window.setTimeout(() => setOtherOnline(false), 35000) as unknown as number;
        } else if (e.kind === 'link:read') {
          const mid = typeof p.messageId === 'string' ? p.messageId : '';
          const mAt = typeof p.messageCreatedAt === 'string' ? p.messageCreatedAt : (typeof p.at === 'string' ? p.at : '');
          if (mid) setSeenIds((prev) => {
            if (prev.has(mid)) return prev;
            const next = new Set(prev);
            next.add(mid);
            if (mAt) seenMeta.current.set(mid, mAt);
            // Also mark all earlier mine messages as seen (if latest seen, earlier were seen too)
            for (const m of threadRef.current) {
              if (m.from === side && m.createdAt <= (mAt || m.createdAt)) {
                // handled in render via createdAt comparison, but ensure map has entry for ordering
                // no need to add all, render will compute via timestamps
              }
            }
            return next;
          });
        }
      }
    });
    return () => {
      stop();
      if (typingTimeout.current !== null) window.clearTimeout(typingTimeout.current);
      if (presenceTimeout.current !== null) window.clearTimeout(presenceTimeout.current);
    };
  }, [linkId, side]);

  // Typing emitter: throttle to 1.5s, send typing:false when draft cleared
  const emitTyping = useCallback((text: string) => {
    const now = Date.now();
    const hasText = text.trim().length > 0;
    if (!hasText) {
      if (lastTypingSent.current !== 0) {
        lastTypingSent.current = 0;
        void sendTyping(linkId, false);
      }
      return;
    }
    if (now - lastTypingSent.current < 1500) return;
    lastTypingSent.current = now;
    void sendTyping(linkId, true);
  }, [linkId]);

  useLayoutEffect(() => {
    if (atEnd) jumpToEnd(false);
  }, [thread.length, atEnd, jumpToEnd]);

  // Also jump when typing indicator appears
  useLayoutEffect(() => {
    if (otherTyping && atEnd) jumpToEnd(true);
  }, [otherTyping, atEnd, jumpToEnd]);

  const unread = unreadChatCount(
    held,
    linkId,
    side,
    side === 'student' ? panels.student.chatSeen?.[linkId] : panels.guardian.chatSeen?.[linkId],
  );
  const room = chatRoom(draft);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    const message = sanitizeChatMessage({
      id: newId('msg'),
      linkId,
      author: t('You'),
      from: side,
      text,
      createdAt: new Date().toISOString(),
    });
    if (!message) return;
    setDraft('');
    lastTypingSent.current = 0;
    void sendTyping(linkId, false);
    setSending(true);
    setWaiting((current) => [...current, message.id]);
    const local = withChatMessage(panels, message, side === 'student' ? 'student' : 'guardian');
    updatePanels(() => local);
    setAtEnd(true);
    try {
      if (side === 'guardian') {
        await sendChatMessage(panels, linkId, text, { id: message.id, createdAt: message.createdAt });
        kickPanelSync();
      } else {
        await runPanelSync();
      }
      setWaiting((current) => current.filter((id) => id !== message.id));
    } catch {
      flash(t('That message is waiting — it will send when you are back online.'));
    } finally {
      setSending(false);
    }
  };

  const retry = async (id: string, text: string) => {
    if (sending) return;
    setSending(true);
    try {
      if (side === 'guardian') {
        const existing = (panels.guardian.chat ?? []).find((entry) => entry.id === id) ??
          (panels.guardian.links.find((entry) => entry.linkId === linkId)?.chat ?? []).find((entry) => entry.id === id);
        await sendChatMessage(panels, linkId, text, { id, createdAt: existing?.createdAt });
        kickPanelSync();
      } else {
        await runPanelSync();
      }
      setWaiting((current) => current.filter((entry) => entry !== id));
    } catch {
      flash(t('That message is still waiting.'));
    } finally {
      setSending(false);
    }
  };

  const handleDraftChange = (value: string) => {
    setDraft(value);
    emitTyping(value);
  };

  return (
    <div className="chat">
      {/* Header with presence */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 4px 8px', fontSize: 13 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: otherOnline ? '#16a34a' : '#9ca3af', boxShadow: otherOnline ? '0 0 0 3px rgba(22,163,74,.18)' : undefined }} aria-hidden />
          <strong>{otherName}</strong>
          <span style={{ color: 'var(--ink-soft)' }}>{otherOnline ? t('Online') : realtimeStatus === 'live' ? t('Live') : ''}</span>
        </span>
        <span style={{ color: 'var(--ink-soft)', fontSize: 12 }}>{otherTyping ? t('{0} is typing…', { 0: otherName }) : ''}</span>
      </div>

      <div
        className="chat-log"
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-label={t('Messages with {0}', { 0: otherName })}
        onScroll={() => {
          const box = logRef.current;
          if (!box) return;
          setAtEnd(box.scrollHeight - box.scrollTop - box.clientHeight < 40);
        }}
      >
        {thread.length === 0 ? (
          <Empty
            compact
            title={t('No messages yet')}
            text={t('Say something. They will read it here, and can answer.')}
          />
        ) : (
          days.map((group) => (
            <section key={group.day} className="chat-day-group">
              <p className="chat-day">{formatFullDate(group.day)}</p>
              {group.messages.map((message) => {
                const mine = message.from === side;
                const isWaiting = waiting.includes(message.id);
                // Seen if this id was read, or any later mine message was read (implies earlier seen)
                const isSeen = mine && (() => {
                  if (seenIds.has(message.id)) return true;
                  for (const [seenId, seenAt] of seenMeta.current.entries()) {
                    if (seenIds.has(seenId) && seenAt && message.createdAt <= seenAt) return true;
                  }
                  return false;
                })();
                return (
                  <div key={message.id} className={cx('chat-row', mine && 'is-mine')}>
                    <div className={cx('chat-bubble', mine && 'is-mine', isWaiting && 'is-waiting')}>
                      {!mine ? <p className="chat-author">{message.author}</p> : null}
                      <p className="chat-text">{message.text}</p>
                      <p className="chat-meta">
                        <span>{formatInstantTime(message.createdAt)}</span>
                        {mine ? (
                          <span style={{ marginInlineStart: 6, fontSize: 11 }}>
                            {isWaiting ? (
                              <button
                                type="button"
                                className="text-btn"
                                disabled={sending}
                                onClick={() => void retry(message.id, message.text)}
                              >
                                {t('Waiting — send again')}
                              </button>
                            ) : isSeen ? (
                              // Weight, not a hard-coded sky blue: the check sits on
                              // the solid-accent bubble, whose colour is the reader's
                              // to choose — blue on the blue accent all but vanished.
                              <span title={t('Seen')} style={{ fontWeight: 650 }}>✓✓ {t('Seen')}</span>
                            ) : (
                              <span title={t('Sent')}>✓✓ {t('Sent')}</span>
                            )}
                          </span>
                        ) : isWaiting ? (
                          <button
                            type="button"
                            className="text-btn"
                            disabled={sending}
                            onClick={() => void retry(message.id, message.text)}
                          >
                            {t('Waiting — send again')}
                          </button>
                        ) : null}
                      </p>
                    </div>
                  </div>
                );
              })}
            </section>
          ))
        )}
        {otherTyping ? (
          <div className="chat-row">
            <div className="chat-bubble" style={{ opacity: 0.85, fontStyle: 'italic' }}>
              <span className="typing-dots" aria-label={t('{0} is typing…', { 0: otherName })}>
                <span>.</span><span>.</span><span>.</span>
              </span>
              <style>{`.typing-dots span{animation:typing 1.2s infinite} .typing-dots span:nth-child(2){animation-delay:.2s} .typing-dots span:nth-child(3){animation-delay:.4s} @keyframes typing{0%,60%,100%{opacity:.25}30%{opacity:1}}`}</style>
            </div>
          </div>
        ) : null}
        <div ref={endRef} />
      </div>
      <div className="chat-foot">
        <p className={cx('chat-connection', `is-${linkSyncStatus}`)} role="status">
          <span className="chat-connection-dot" aria-hidden="true" />
          {linkSyncStatus === 'live'
            ? `Live${otherOnline ? ' • ' + otherName + ' online' : ''}`
            : linkSyncStatus === 'offline'
              ? t('Offline — messages send when you reconnect')
              : t('Reconnecting…')}
        </p>
        {!atEnd ? (
          <button type="button" className="btn btn-ghost btn-tiny chat-jump" onClick={() => jumpToEnd(true)}>
            {t('Newest')}
          </button>
        ) : null}
        {unread > 0 ? <p className="chat-unread">{t('{0} new', { 0: faNum(unread) })}</p> : null}
      </div>
      <form
        className="chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <div className="chat-composer-field">
          <textarea
            className="input"
            rows={2}
            maxLength={CHAT_TEXT_MAX}
            value={draft}
            placeholder={t('Write to {0}', { 0: otherName })}
            aria-label={t('Write to {0}', { 0: otherName })}
            onChange={(event) => handleDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
          />
          {room <= ROOM_WARNING ? (
            <span className={cx('chat-count', room <= 0 && 'is-out')}>{faNum(Math.max(0, room))}</span>
          ) : null}
        </div>
        <button type="submit" className="btn btn-primary btn-small" disabled={sending || !draft.trim()}>
          {sending ? <span className="spinner" aria-hidden="true" /> : <ChatIcon size={14} />}
          {t('Send')}
        </button>
      </form>
    </div>
  );
}
