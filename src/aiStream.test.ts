// @vitest-environment node
/**
 * Reading an answer while it is still being written.
 *
 * The stream arrives in whatever pieces the network happens to send, which is
 * almost never one event per piece. So these tests are mostly about the joins:
 * an event split across two reads, several events in one read, and the last
 * event of all arriving without the blank line that usually ends it.
 */
import { describe, expect, it } from 'vitest';
import { readAiStream } from './ai';

function sse(events: string[], tail = '\n\n'): Response {
  const body = events.map((data) => `data: ${data}\n\n`).join('') + tail;
  return new Response(body);
}

/** A stream delivered in the given pieces, whatever the event boundaries are. */
function chunked(pieces: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const piece of pieces) controller.enqueue(new TextEncoder().encode(piece));
      controller.close();
    },
  });
  return new Response(stream);
}

const say = (text: string): string => JSON.stringify({ choices: [{ delta: { content: text } }] });

describe('reading a streamed answer', () => {
  it('joins every piece into the whole answer', async () => {
    const text = await readAiStream(sse([say('Hello'), say(', '), say('world'), '[DONE]']));
    expect(text).toBe('Hello, world');
  });

  it('reports the answer as it grows, not only at the end', async () => {
    const seen: string[] = [];
    await readAiStream(sse([say('one'), say(' two'), say(' three')]), (partial) => seen.push(partial));
    expect(seen).toEqual(['one', 'one two', 'one two three']);
  });

  it('waits for an event that was cut in half by the network', async () => {
    const event = `data: ${say('split')}\n\n`;
    const cut = Math.floor(event.length / 2);
    const text = await readAiStream(chunked([event.slice(0, cut), event.slice(cut)]));
    expect(text).toBe('split');
  });

  it('reads several events that arrived in one piece', async () => {
    const text = await readAiStream(chunked([`data: ${say('a')}\n\ndata: ${say('b')}\n\n`]));
    expect(text).toBe('ab');
  });

  it('reads the last event even when the stream closes without a blank line', async () => {
    // A well-behaved provider ends with a blank line. Some do not, and that
    // last event is the one that matters most — it is the end of the answer.
    expect(await readAiStream(chunked([`data: ${say('tail')}\n\n`]))).toBe('tail');
    expect(await readAiStream(chunked([`data: ${say('no blank line')}`]))).toBe('no blank line');
  });

  it('ignores the keep-alive comments and odd lines providers send', async () => {
    const text = await readAiStream(chunked([': keep-alive\n\n', 'event: ping\n\n', `data: ${say('kept')}\n\n`, 'data: [DONE]\n\n']));
    expect(text).toBe('kept');
  });

  it('ignores an event it cannot understand rather than failing the answer', async () => {
    const text = await readAiStream(chunked(['data: not json\n\n', `data: ${say('still here')}\n\n`]));
    expect(text).toBe('still here');
  });

  it('reads an answer sent as a whole message instead of a delta', async () => {
    const text = await readAiStream(sse([JSON.stringify({ choices: [{ message: { content: 'all at once' } }] })]));
    expect(text).toBe('all at once');
  });

  it('has nothing to read when the response carries no stream', async () => {
    expect(await readAiStream(new Response('{"choices":[]}'))).toBe('');
  });
});
