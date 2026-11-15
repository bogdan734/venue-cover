import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../test/app.js';

let t: TestApp;
let base: string;
let writer: string;
let reader1: string;
let reader2: string;
let counter = 0;

beforeAll(async () => {
  t = await createTestApp();
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(t.app.server.address() as AddressInfo).port}`;
  writer = await t.keyFor('prg_1', ['quotes:read', 'quotes:write']);
  reader1 = await t.keyFor('prg_1', ['quotes:read']);
  reader2 = await t.keyFor('prg_2', ['quotes:read']);
});
afterAll(() => t.close());

interface Frame {
  id?: string;
  event?: string;
  data?: string;
}

// Opens the stream and returns what it has received so far, with a way to wait for frames and to hang up.
async function openStream(key: string, headers: Record<string, string> = {}) {
  const controller = new AbortController();
  const res = await fetch(`${base}/v1/events/stream`, {
    headers: { authorization: `Bearer ${key}`, ...headers },
    signal: controller.signal,
  });
  const frames: Frame[] = [];
  let buffer = '';
  const reading = (async () => {
    if (!res.body) return;
    const decoder = new TextDecoder();
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        let split = buffer.indexOf('\n\n');
        while (split !== -1) {
          const block = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          const frame: Frame = {};
          for (const line of block.split('\n')) {
            if (line.startsWith('id: ')) frame.id = line.slice(4);
            else if (line.startsWith('event: ')) frame.event = line.slice(7);
            else if (line.startsWith('data: ')) frame.data = line.slice(6);
          }
          if (frame.event) frames.push(frame);
          split = buffer.indexOf('\n\n');
        }
      }
    } catch {
      // aborted
    }
  })();
  return {
    res,
    frames,
    async waitFor(predicate: (f: Frame) => boolean, ms = 3000): Promise<Frame | undefined> {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        const found = frames.find(predicate);
        if (found) return found;
        await new Promise((r) => setTimeout(r, 25));
      }
      return undefined;
    },
    async close() {
      controller.abort();
      await reading;
    },
  };
}

const createQuote = async (key = writer) => {
  const res = await t.app.inject({
    method: 'POST',
    url: '/v1/quotes',
    headers: { authorization: `Bearer ${key}`, 'idempotency-key': `st-${++counter}` },
    payload: {
      activityId: await t.activityId('Yoga class'),
      participants: 20,
      hours: 2,
      alcohol: 'none',
      eventDate: '2026-12-20',
      startTime: '18:00',
      limitCents: 200_000_000,
      holder: { name: 'Pat Example', email: 'pat@example.org' },
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
};

describe('GET /v1/events/stream', () => {
  it('delivers an event once the transaction that made it has committed', async () => {
    const stream = await openStream(reader1);
    try {
      expect(stream.res.status).toBe(200);
      expect(stream.res.headers.get('content-type')).toContain('text/event-stream');
      const quoteId = await createQuote();
      const frame = await stream.waitFor(
        (f) => f.event === 'quote.created' && f.data?.includes(quoteId) === true,
      );
      expect(frame).toBeDefined();
      expect(Number(frame?.id)).toBeGreaterThan(0);
      const body = JSON.parse(frame?.data ?? '{}');
      expect(body).toMatchObject({ type: 'quote.created', programId: 'prg_1', data: { quoteId } });
      expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    } finally {
      await stream.close();
    }
  });

  it('never shows one program the events of another', async () => {
    const stream = await openStream(reader2);
    try {
      const mine = await createQuote(await t.keyFor('prg_2', ['quotes:write']));
      await createQuote(); // program 1
      expect(await stream.waitFor((f) => f.data?.includes(mine) === true)).toBeDefined();
      await new Promise((r) => setTimeout(r, 700));
      expect(stream.frames.every((f) => JSON.parse(f.data ?? '{}').programId === 'prg_2')).toBe(
        true,
      );
    } finally {
      await stream.close();
    }
  });

  it('starts from the live end by default and resumes from Last-Event-ID', async () => {
    const before = await createQuote();
    const live = await openStream(reader1);
    const first = await createQuote();
    const seen = await live.waitFor((f) => f.data?.includes(first) === true);
    expect(live.frames.some((f) => f.data?.includes(before))).toBe(false); // not replayed
    await live.close();

    const resumed = await openStream(reader1, { 'last-event-id': String(Number(seen?.id) - 1) });
    try {
      expect(await resumed.waitFor((f) => f.data?.includes(first) === true)).toBeDefined();
    } finally {
      await resumed.close();
    }
  });

  it('needs a key with the read scope', async () => {
    expect((await fetch(`${base}/v1/events/stream`)).status).toBe(401);
    const noScope = await t.keyFor('prg_1', ['quotes:write']);
    expect(
      (await fetch(`${base}/v1/events/stream`, { headers: { authorization: `Bearer ${noScope}` } }))
        .status,
    ).toBe(403);
  });
});
