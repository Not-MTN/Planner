/**
 * Reading a photo of a timetable.
 *
 * These blocks are what the entire week gets planned around, so the expensive
 * failures are not crashes — they are confident mistakes: a block on the wrong
 * day, or one that ends before it begins. Those reshape the week silently.
 * So the tests are mostly about refusing to guess.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseTimetableImage, normalizeTimetable } from './ai';

function visionReply(payload: unknown) {
  const sent = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
  }));
  vi.stubGlobal('fetch', sent);
  return sent;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reading a timetable from a picture', () => {
  it('turns a legible grid into weekly blocks', async () => {
    const sent = visionReply({
      summary: 'A five-day school timetable, Week A.',
      blocks: [
        { title: 'Mathematics', weekday: 1, startTime: '09:00', endTime: '10:00', detail: 'Room 12' },
        { title: 'Physics', weekday: 2, startTime: '11:00', endTime: '12:30', detail: 'Lab 3' },
      ],
      unclear: [],
    });

    const parsed = await parseTimetableImage({ imageDataUrl: 'data:image/png;base64,AAAA' });
    expect(parsed.blocks).toHaveLength(2);
    expect(parsed.blocks[0]).toEqual({ title: 'Mathematics', weekday: 1, startTime: '09:00', endTime: '10:00', detail: 'Room 12' });
    // The picture has to actually go out, or nothing was read at all.
    const body = JSON.parse(String(sent.mock.calls[0]?.[1]?.body ?? '{}')) as {
      model: string;
      messages: Array<{ role: string; content: unknown }>;
    };
    expect(JSON.stringify(body.messages)).toContain('image_url');
  });

  it('asks for the weekday numbering the rest of the planner uses', async () => {
    const sent = visionReply({ summary: 'ok', blocks: [], unclear: [] });
    await parseTimetableImage({ imageDataUrl: 'data:image/png;base64,AAAA' });
    const body = JSON.parse(String(sent.mock.calls[0]?.[1]?.body ?? '{}')) as {
      messages: Array<{ role: string; content: string }>;
    };
    const system = body.messages.find((message) => message.role === 'system')?.content ?? '';
    // Off by one here would shift every block by a day.
    expect(system).toMatch(/0\s*=\s*Sunday/);
    expect(system).toMatch(/6\s*=\s*Saturday/);
  });

  it('tells the model to report what it cannot read rather than invent it', async () => {
    const sent = visionReply({ summary: 'ok', blocks: [], unclear: [] });
    await parseTimetableImage({ imageDataUrl: 'data:image/png;base64,AAAA' });
    const body = JSON.parse(String(sent.mock.calls[0]?.[1]?.body ?? '{}')) as {
      messages: Array<{ role: string; content: string }>;
    };
    const system = body.messages.find((message) => message.role === 'system')?.content ?? '';
    expect(system).toMatch(/do NOT guess/i);
    expect(system).toMatch(/do not invent/i);
  });

  it('drops a block that would land on the wrong day', () => {
    const parsed = normalizeTimetable({
      blocks: [
        { title: 'Good', weekday: 3, startTime: '09:00', endTime: '10:00' },
        { title: 'Seventh day', weekday: 7, startTime: '09:00', endTime: '10:00' },
        { title: 'Negative day', weekday: -1, startTime: '09:00', endTime: '10:00' },
        { title: 'Text day', weekday: 'Monday', startTime: '09:00', endTime: '10:00' },
      ],
    });
    expect(parsed.blocks.map((block) => block.title)).toEqual(['Good']);
  });

  it('drops a block that ends before it begins, instead of breaking the day', () => {
    const parsed = normalizeTimetable({
      blocks: [
        { title: 'Backwards', weekday: 1, startTime: '14:00', endTime: '09:00' },
        { title: 'Zero length', weekday: 1, startTime: '09:00', endTime: '09:00' },
        { title: 'Fine', weekday: 1, startTime: '09:00', endTime: '10:30' },
      ],
    });
    expect(parsed.blocks.map((block) => block.title)).toEqual(['Fine']);
  });

  it('drops a block with an unreadable time or no name', () => {
    const parsed = normalizeTimetable({
      blocks: [
        { title: 'No time', weekday: 1, startTime: '', endTime: '10:00' },
        { title: 'Half past whenever', weekday: 1, startTime: '9am', endTime: '10:00' },
        { title: '   ', weekday: 1, startTime: '09:00', endTime: '10:00' },
        { title: 'Kept', weekday: 5, startTime: '13:00', endTime: '14:00' },
      ],
    });
    expect(parsed.blocks.map((block) => block.title)).toEqual(['Kept']);
  });

  it('survives a reply that is not shaped like a timetable at all', () => {
    expect(normalizeTimetable(null).blocks).toEqual([]);
    expect(normalizeTimetable('nonsense').blocks).toEqual([]);
    expect(normalizeTimetable({ blocks: 'not an array' }).blocks).toEqual([]);
    expect(normalizeTimetable({ blocks: [null, 5, 'x'] }).blocks).toEqual([]);
    // And it still says something readable rather than showing a blank card.
    expect(normalizeTimetable({}).summary.length).toBeGreaterThan(0);
  });

  it('reports what could not be read, once each and without inventing a time', () => {
    const parsed = normalizeTimetable({
      summary: 'Partly legible.',
      blocks: [{ title: 'History', weekday: 4, startTime: '10:00', endTime: '11:00' }],
      unclear: ['Friday period 3', 'Friday period 3', 'the room for Tuesday period 1'],
    });
    expect(parsed.unclear).toEqual(['Friday period 3', 'the room for Tuesday period 1']);
    expect(parsed.blocks).toHaveLength(1);
  });
});
