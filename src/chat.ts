/**
 * The thread between a guardian and one student.
 *
 * A notice is a one-way note: it lands in an inbox, it is read once, and the
 * only answer to it is another note. This is the other thing — a conversation,
 * where either side can pick it up and the other reads it when they next open
 * the panel. It is words and nothing else, it rides the same encrypted link as
 * everything else between them, and it is capped on both sides so a thread
 * that runs for a year does not grow without end.
 *
 * Everything here is pure. What travels over the wire is decided in
 * `auth/links.ts`; these are the shapes both sides agree on first.
 */
import { localDateFromTimestamp } from './dates';
import { CHAT_KEPT, CHAT_TEXT_MAX } from './types';
import type { ChatMessage, ChatSide, Panels } from './types';

/** One message as the wire carries it. A malformed one is dropped, not guessed at. */
export function sanitizeChatMessage(value: unknown): ChatMessage | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id.slice(0, 80) : '';
  const linkId = typeof raw.linkId === 'string' ? raw.linkId.slice(0, 64) : '';
  const text = typeof raw.text === 'string' ? raw.text.trim().slice(0, CHAT_TEXT_MAX) : '';
  const createdAt =
    typeof raw.createdAt === 'string' && raw.createdAt.length <= 40 && Number.isFinite(Date.parse(raw.createdAt))
      ? raw.createdAt
      : '';
  if (!id || !linkId || !text || !createdAt) return null;
  return {
    id,
    linkId,
    author: typeof raw.author === 'string' ? raw.author.trim().slice(0, 60) : '',
    from: raw.from === 'guardian' ? 'guardian' : 'student',
    text,
    createdAt,
  };
}

/**
 * Fold freshly pulled messages into the thread already held, oldest first.
 *
 * A message that is already there is left exactly as it is — that is what keeps
 * a thread in order when two devices have both pulled it — and the id decides
 * identity, so a message that arrives twice is one message.
 */
export function mergeChat(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const message of [...current, ...incoming]) byId.set(message.id, byId.get(message.id) ?? message);
  return [...byId.values()]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    .slice(-CHAT_KEPT);
}

/** One link's thread, oldest first — the order a conversation reads in. */
export function chatFor(messages: ChatMessage[] | undefined, linkId: string): ChatMessage[] {
  return (messages ?? [])
    .filter((message) => message.linkId === linkId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/** One day of a thread, oldest first within the day. */
export interface ChatDay {
  /** The calendar day on the reading device, YYYY-MM-DD. */
  day: string;
  messages: ChatMessage[];
}

/**
 * The thread cut into days.
 *
 * A conversation is read in days, not as one flat list: "yesterday" is a real
 * boundary in a thread and pretending otherwise makes a long one unreadable.
 * Grouped here rather than in the view so both panels cut it the same way.
 *
 * The cut is the reader's own midnight, not UTC's: `createdAt` is an instant,
 * so its day is whatever day that instant fell on where the device is. (The
 * wire's slice(0, 10) is the UTC day, which put late-evening messages under
 * the wrong date for anyone east of Greenwich.)
 */
export function chatDays(messages: ChatMessage[]): ChatDay[] {
  const days: ChatDay[] = [];
  for (const message of messages) {
    const day = localDateFromTimestamp(message.createdAt);
    const last = days[days.length - 1];
    if (last && last.day === day) last.messages.push(message);
    else days.push({ day, messages: [message] });
  }
  return days;
}

/** How much of a message is left to write. Negative means it was cut. */
export function chatRoom(text: string): number {
  return CHAT_TEXT_MAX - text.length;
}

/**
 * Messages the other side has written since this side last looked.
 *
 * `seen` is the timestamp of the last message read, held per link on the panel:
 * it survives a reload, and it does not need the other device to agree.
 */
export function unreadChatCount(
  messages: ChatMessage[] | undefined,
  linkId: string,
  me: ChatSide,
  seen: string | null | undefined,
): number {
  const since = seen ?? '';
  return chatFor(messages, linkId).filter(
    (message) => message.from !== me && message.createdAt > since,
  ).length;
}

/** The thread for one link, as the panel holds it. */
export function withChatMessage(panels: Panels, message: ChatMessage, side: 'student' | 'guardian'): Panels {
  const merged = mergeChat(
    side === 'student' ? (panels.student.chat ?? []) : (panels.guardian.chat ?? []),
    [message],
  );
  return side === 'student'
    ? { ...panels, student: { ...panels.student, chat: merged } }
    : {
        ...panels,
        guardian: {
          ...panels.guardian,
          chat: merged,
          links: panels.guardian.links.map((link) =>
            link.linkId === message.linkId
              ? { ...link, chat: mergeChat(link.chat ?? [], [message]) }
              : link,
          ),
        },
      };
}

/** Remember how far this side has read, so the count on the tab goes quiet. */
export function withChatSeen(panels: Panels, linkId: string, at: string, side: 'student' | 'guardian'): Panels {
  return side === 'student'
    ? {
        ...panels,
        student: {
          ...panels.student,
          chatSeen: { ...(panels.student.chatSeen ?? {}), [linkId]: at },
        },
      }
    : {
        ...panels,
        guardian: {
          ...panels.guardian,
          chatSeen: { ...(panels.guardian.chatSeen ?? {}), [linkId]: at },
        },
      };
}

/** How far this side has read one thread. */
export function chatSeenAt(panels: Panels, linkId: string, side: 'student' | 'guardian'): string | null {
  const seen = side === 'student' ? panels.student.chatSeen : panels.guardian.chatSeen;
  return seen?.[linkId] ?? null;
}
