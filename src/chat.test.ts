import { describe, expect, it, vi } from 'vitest';
import {
  chatDays,
  chatFor,
  chatRoom,
  chatSeenAt,
  mergeChat,
  sanitizeChatMessage,
  unreadChatCount,
  withChatMessage,
  withChatSeen,
} from './chat';
import { createEmptyState } from './types';
import type { ChatMessage, Panels } from './types';

const message = (id: string, at: string, from: 'student' | 'guardian', linkId = 'link-1'): ChatMessage => ({
  id,
  linkId,
  author: from === 'guardian' ? 'Mum' : 'Sara',
  from,
  text: `${id} written at ${at}`,
  createdAt: at,
});

const panels = (): Panels => createEmptyState().panels;

describe('a message as it travels', () => {
  it('keeps a whole message and drops a broken one', () => {
    expect(sanitizeChatMessage(message('m1', '2026-05-04T08:00:00.000Z', 'guardian'))?.id).toBe('m1');
    expect(sanitizeChatMessage({ ...message('m2', '2026-05-04T08:00:00.000Z', 'student'), text: '   ' })).toBeNull();
    expect(sanitizeChatMessage({ ...message('m3', 'not a date', 'student') })).toBeNull();
    expect(sanitizeChatMessage(null)).toBeNull();
  });

  it('calls an unknown writer a student rather than inventing a side', () => {
    expect(sanitizeChatMessage({ ...message('m4', '2026-05-04T08:00:00.000Z', 'student'), from: 'uncle' })?.from).toBe(
      'student',
    );
  });

  it('cuts a message that runs on', () => {
    const long = sanitizeChatMessage({
      ...message('m5', '2026-05-04T08:00:00.000Z', 'student'),
      text: 'a'.repeat(5_000),
    });
    expect(long?.text.length).toBeLessThanOrEqual(600);
  });
});

describe('a thread held together', () => {
  it('reads oldest first, whichever way the messages arrived', () => {
    const thread = mergeChat(
      [message('b', '2026-05-04T09:00:00.000Z', 'guardian')],
      [message('a', '2026-05-04T08:00:00.000Z', 'student'), message('c', '2026-05-04T10:00:00.000Z', 'student')],
    );
    expect(thread.map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
  });

  it('is one message when it arrives twice', () => {
    const twice = mergeChat(
      [message('a', '2026-05-04T08:00:00.000Z', 'student')],
      [message('a', '2026-05-04T08:00:00.000Z', 'student')],
    );
    expect(twice).toHaveLength(1);
  });

  it('keeps what it already held rather than letting a pull rewrite it', () => {
    const held = message('a', '2026-05-04T08:00:00.000Z', 'student');
    const rewritten = { ...held, text: 'rewritten by a later pull' };
    expect(mergeChat([held], [rewritten])[0]?.text).toBe(held.text);
  });

  it('stops growing: a year of talk does not fill the panel', () => {
    const many = Array.from({ length: 400 }, (_, index) =>
      message(`m${index}`, `2026-05-04T08:${String(index % 60).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`, 'student'),
    );
    expect(mergeChat([], many).length).toBeLessThanOrEqual(80);
  });

  it('holds one thread per guardian', () => {
    const thread = chatFor(
      [message('a', '2026-05-04T08:00:00.000Z', 'student', 'link-1'), message('b', '2026-05-04T08:00:00.000Z', 'student', 'link-2')],
      'link-2',
    );
    expect(thread.map((entry) => entry.id)).toEqual(['b']);
  });
});

describe('what has not been read', () => {
  it('counts the other side’s words, not one’s own', () => {
    const thread = [
      message('a', '2026-05-04T08:00:00.000Z', 'guardian'),
      message('b', '2026-05-04T09:00:00.000Z', 'student'),
      message('c', '2026-05-04T10:00:00.000Z', 'guardian'),
    ];
    expect(unreadChatCount(thread, 'link-1', 'student', null)).toBe(2);
    expect(unreadChatCount(thread, 'link-1', 'guardian', null)).toBe(1);
  });

  it('goes quiet from the moment the thread was last read', () => {
    const thread = [
      message('a', '2026-05-04T08:00:00.000Z', 'guardian'),
      message('b', '2026-05-04T10:00:00.000Z', 'guardian'),
    ];
    expect(unreadChatCount(thread, 'link-1', 'student', '2026-05-04T09:00:00.000Z')).toBe(1);
    expect(unreadChatCount(thread, 'link-1', 'student', '2026-05-04T10:00:00.000Z')).toBe(0);
  });
});

describe('what the panels hold', () => {
  it('puts a guardian’s words on the thread and on the link', () => {
    const withLink: Panels = {
      ...panels(),
      guardian: {
        ...panels().guardian,
        links: [{ ...createEmptyState().panels.guardian.links[0]!, linkId: 'link-1' }],
      },
    };
    const next = withChatMessage(withLink, message('a', '2026-05-04T08:00:00.000Z', 'guardian'), 'guardian');
    expect(next.guardian.chat).toHaveLength(1);
    expect(next.guardian.links[0]?.chat).toHaveLength(1);
    expect(next.student.chat ?? []).toHaveLength(0);
  });

  it('puts a student’s words on their side only', () => {
    const next = withChatMessage(panels(), message('a', '2026-05-04T08:00:00.000Z', 'student'), 'student');
    expect(next.student.chat).toHaveLength(1);
    expect(next.guardian.chat ?? []).toHaveLength(0);
  });

  it('remembers how far each side has read, per thread', () => {
    const read = withChatSeen(panels(), 'link-1', '2026-05-04T10:00:00.000Z', 'student');
    expect(chatSeenAt(read, 'link-1', 'student')).toBe('2026-05-04T10:00:00.000Z');
    // The other side has not read anything, and the other thread has not been read either.
    expect(chatSeenAt(read, 'link-1', 'guardian')).toBeNull();
    expect(chatSeenAt(read, 'link-2', 'student')).toBeNull();
  });
});

describe('a thread cut into days', () => {
  const thread = [
    message('a', '2026-05-04T08:00:00.000Z', 'guardian'),
    message('b', '2026-05-04T09:00:00.000Z', 'student'),
    message('c', '2026-05-05T08:00:00.000Z', 'guardian'),
  ];

  it('groups by calendar day and keeps the order inside a day', () => {
    expect(chatDays(thread).map((group) => group.day)).toEqual(['2026-05-04', '2026-05-05']);
    expect(chatDays(thread)[0]?.messages.map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('starts a new group when the day turns over, even for the same writer', () => {
    const sameWriter = [
      message('a', '2026-05-04T23:00:00.000Z', 'guardian'),
      message('b', '2026-05-05T01:00:00.000Z', 'guardian'),
    ];
    expect(chatDays(sameWriter)).toHaveLength(2);
  });

  it("cuts the day at the reader's midnight, not at UTC's", () => {
    vi.stubEnv('TZ', 'Asia/Tehran'); // UTC+3:30
    try {
      // Both instants carry 4 May in UTC; where the reader is standing
      // they are 00:15 and 00:45 on 5 May, so the heading must say so.
      const afterMidnight = [
        message('a', '2026-05-04T20:45:00.000Z', 'guardian'),
        message('b', '2026-05-04T21:15:00.000Z', 'student'),
      ];
      expect(chatDays(afterMidnight).map((group) => group.day)).toEqual(['2026-05-05']);
      expect(chatDays(afterMidnight)[0]?.messages.map((entry) => entry.id)).toEqual(['a', 'b']);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('is nothing at all for an empty thread', () => {
    expect(chatDays([])).toEqual([]);
  });
});

describe('how much of a message is left', () => {
  it('counts down from the cap', () => {
    expect(chatRoom('')).toBe(600);
    expect(chatRoom('abc')).toBe(597);
  });

  it('goes negative when a paste runs past it', () => {
    expect(chatRoom('a'.repeat(601))).toBe(-1);
  });
});
