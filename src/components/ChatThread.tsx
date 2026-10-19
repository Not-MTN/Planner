/**
 * The thread between a guardian and one student.
 *
 * One component, both sides of it: what changes is who is writing and who is
 * reading, and that is `side`. Everything else — the order, the caps, the way a
 * message that has not landed yet is shown — is the same, because a
 * conversation that behaves differently depending on which end you hold is two
 * conversations.
 *
 * A message is written locally first and shown at once, marked as on its way.
 * If the send fails it stays, unsent, with a button to try again: a thread that
 * quietly ate a message because the signal dropped is worse than one that says
 * so.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePlanner } from '../context';
import { cx } from '../cx';
import { displayTime, formatFullDate } from '../dates';
import { faNum, t } from '../i18n';
import { ChatIcon } from '../icons';
import { sendChatMessage, syncStudentInbox } from '../auth/links';
import {
  chatDays,
  chatFor,
  chatRoom,
  sanitizeChatMessage,
  unreadChatCount,
  withChatMessage,
  withChatSeen,
} from '../chat';
import { newId } from '../panels';
import { CHAT_TEXT_MAX } from '../types';
import type { ChatSide } from '../types';
import { Empty } from './ui';

/** How close to the cap the counter starts showing: nobody counts from zero. */
const ROOM_WARNING = 80;

export function ChatThread({
  linkId,
  otherName,
  side,
}: {
  /** The link this thread belongs to. */
  linkId: string;
  /** What the panel calls the other side of it. */
  otherName: string;
  side: ChatSide;
}) {
  const { panels, state, updatePanels, flash } = usePlanner();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [waiting, setWaiting] = useState<string[]>([]);
  const [atEnd, setAtEnd] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const held = side === 'student' ? panels.student.chat : panels.guardian.chat;
  const thread = chatFor(held, linkId);
  const days = chatDays(thread);

  const jumpToEnd = useCallback((smooth: boolean) => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  // Reading the thread is what marks it read: there is no badge to clear and no
  // "mark as read" to forget to press.
  useEffect(() => {
    const latest = thread[thread.length - 1];
    if (!latest) return;
    const seen = side === 'student' ? panels.student.chatSeen : panels.guardian.chatSeen;
    if ((seen?.[linkId] ?? '') >= latest.createdAt) return;
    updatePanels((current) => withChatSeen(current, linkId, latest.createdAt, side));
  }, [linkId, thread, panels.student.chatSeen, panels.guardian.chatSeen, side, updatePanels]);

  // A conversation is read from the bottom up, so the newest line is in view —
  // but only when they are already down there. Yanking someone back to the
  // bottom while they are reading yesterday is how a thread gets closed.
  useLayoutEffect(() => {
    if (atEnd) jumpToEnd(false);
  }, [thread.length, atEnd, jumpToEnd]);

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
      // One's own messages are never shown with a name on them — the side they
      // sit on says who wrote them — so this is only a placeholder for the
      // moment before the copy that travelled arrives.
      author: t('You'),
      from: side,
      text,
      createdAt: new Date().toISOString(),
    });
    if (!message) return;
    setDraft('');
    setSending(true);
    setWaiting((current) => [...current, message.id]);
    // In the thread straight away: the writer sees their own words where they
    // will land, rather than waiting on a round trip to find out they were heard.
    const local = withChatMessage(panels, message, side === 'student' ? 'student' : 'guardian');
    updatePanels(() => local);
    setAtEnd(true);
    try {
      // The guardian writes to their own slot; the student's half rides the
      // next inbox sync, the way everything else they send does.
      if (side === 'guardian') {
        await sendChatMessage(panels, linkId, text);
      } else {
        await syncStudentInbox(local, state.goals);
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
        await sendChatMessage(panels, linkId, text);
      } else {
        await syncStudentInbox(panels, state.goals);
      }
      setWaiting((current) => current.filter((entry) => entry !== id));
    } catch {
      flash(t('That message is still waiting.'));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="chat">
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
                return (
                  <div key={message.id} className={cx('chat-row', mine && 'is-mine')}>
                    <div className={cx('chat-bubble', mine && 'is-mine', isWaiting && 'is-waiting')}>
                      {!mine ? <p className="chat-author">{message.author}</p> : null}
                      <p className="chat-text">{message.text}</p>
                      <p className="chat-meta">
                        <span>{displayTime(message.createdAt.slice(11, 16))}</span>
                        {isWaiting ? (
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
        <div ref={endRef} />
      </div>
      <div className="chat-foot">
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
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends; a new line is Shift+Enter, the way a message reads.
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
