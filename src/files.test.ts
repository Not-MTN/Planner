import { describe, expect, it } from 'vitest';
import { attachmentKind, formatSize, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_NOTE } from './files';
import { sanitizeState } from './storage';
import { createEmptyState } from './types';

describe('attachments', () => {
  it('classifies audio, image and other files', () => {
    expect(attachmentKind('audio/mpeg', 'song.mp3')).toBe('audio');
    expect(attachmentKind('', 'session.ogg')).toBe('audio');
    expect(attachmentKind('image/png', 'shot.png')).toBe('image');
    expect(attachmentKind('', 'HEIC-photo.heic')).toBe('image');
    expect(attachmentKind('application/pdf', 'doc.pdf')).toBe('file');
    expect(attachmentKind('', 'archive.zip')).toBe('file');
  });

  it('formats sizes in a friendly way', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(4096)).toBe('4 KB');
    expect(formatSize(3.5 * 1024 * 1024)).toBe('3.5 MB');
  });

  it('caps are generous but bounded', () => {
    expect(MAX_ATTACHMENT_BYTES).toBe(20 * 1024 * 1024);
    expect(MAX_ATTACHMENTS_PER_NOTE).toBe(12);
  });

  it('keeps attachments through sanitize/export round trips and strips junk', () => {
    const state = createEmptyState();
    state.notes.push({
      id: 'n1',
      title: 'Song idea',
      body: '',
      kind: 'quick',
      date: null,
      pinned: false,
      createdAt: '2026-09-28T10:00:00.000Z',
      updatedAt: '2026-09-28T10:00:00.000Z',
      attachments: [
        { id: 'att-1', name: 'melody.mp3', mime: 'audio/mpeg', size: 12345, addedAt: '2026-09-28T10:00:00.000Z' },
        // junk the sanitizer must drop:
        { id: '', name: 'x', mime: '', size: 1, addedAt: '2026-09-28T10:00:00.000Z' },
        { name: 'no id', mime: '', size: -5, addedAt: '2026-09-28T10:00:00.000Z' } as never,
      ],
    });
    const clean = sanitizeState(state);
    expect(clean).not.toBeNull();
    const note = clean!.notes.find((item) => item.id === 'n1');
    expect(note?.attachments?.length).toBe(1);
    expect(note?.attachments?.[0].name).toBe('melody.mp3');
    expect(note?.attachments?.[0].size).toBe(12345);
  });
});
