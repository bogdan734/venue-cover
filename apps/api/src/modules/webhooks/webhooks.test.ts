import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, NOW, type TestApp } from '../../../test/app.js';
import { appendEvent } from '../events/index.js';
import { createFetchClient, MAX_DELIVERY_ATTEMPTS, verify } from './index.js';

let t: TestApp;
let manage: string; // program 1: manages endpoints and creates quotes
let manage2: string; // program 2
let counter = 0;

beforeAll(async () => {
  t = await createTestApp();
  manage = await t.keyFor('prg_1', ['webhooks:manage', 'quotes:read', 'quotes:write']);
  manage2 = await t.keyFor('prg_2', ['webhooks:manage']);
});
afterAll(() => t.close());
beforeEach(async () => {
  // Each test starts with no deliveries and no live endpoints, so only its own show up.
  await t.db.deleteFrom('webhook_delivery').execute();
  await t.db.updateTable('webhook_endpoint').set({ active: false }).execute();
  t.http.calls.length = 0;
  t.http.handler = () => 200;
  t.now.value = NOW;
});

const call = (method: 'GET' | 'POST' | 'DELETE', url: string, key = manage, payload?: object) =>
  t.app.inject({
    method,
    url,
    headers: {
      authorization: `Bearer ${key}`,
      ...(url === '/v1/quotes' ? { 'idempotency-key': `w-${++counter}` } : {}),
    },
    ...(payload ? { payload } : {}),
  });

async function register(
  events: string[],
  key = manage,
  url = `https://hooks.example.test/${++counter}`,
) {
  const res = await call('POST', '/v1/webhook-endpoints', key, { url, events });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string; url: string; secret: string };
}

// Emits an event for program 1 the same way the application does, then lets the relay fan it out.
async function emit(
  type: 'quote.created' | 'quote.referred' = 'quote.created',
  programId = 'prg_1',
) {
  const event = await t.db
    .transaction()
    .execute((trx) => appendEvent(trx, { type, programId, data: { quoteId: 'qte_x' } }));
  await t.drain();
  return event;
}
const deliveriesOf = (eventId: string) =>
  t.db.selectFrom('webhook_delivery').selectAll().where('event_id', '=', eventId).execute();
const failedEvents = async () =>
  (
    await t.db
      .selectFrom('outbox_event')
      .select('data')
      .where('type', '=', 'webhook.delivery.failed')
      .execute()
  ).map((e) => e.data as { deliveryId: string; reason: string });
const later = (seconds: number) => {
  t.now.value = new Date(NOW.getTime() + seconds * 1000);
};

describe('endpoints', () => {
  it('registers an endpoint and shows the secret once', async () => {
    const endpoint = await register(['quote.created']);
    expect(endpoint.secret).toMatch(/^whsec_/);
    const list = (await call('GET', '/v1/webhook-endpoints')).json().endpoints;
    const listed = list.find((e: { id: string }) => e.id === endpoint.id);
    expect(listed).toMatchObject({ url: endpoint.url, events: ['quote.created'], active: true });
    expect(JSON.stringify(list)).not.toContain(endpoint.secret);
  });

  it('refuses unsafe URLs and unknown events', async () => {
    const bad = [
      { url: 'http://hooks.example.test/a', events: ['quote.created'] },
      { url: 'https://localhost/a', events: ['quote.created'] },
      { url: 'https://10.0.0.5/a', events: ['quote.created'] },
      { url: 'https://169.254.169.254/latest', events: ['quote.created'] },
      { url: 'https://user:pw@hooks.example.test/a', events: ['quote.created'] },
      { url: 'not a url', events: ['quote.created'] },
      { url: 'https://hooks.example.test/a', events: [] },
      { url: 'https://hooks.example.test/a', events: ['webhook.delivery.failed'] },
      { url: 'https://hooks.example.test/a', events: ['made.up'] },
    ];
    for (const body of bad) {
      const res = await call('POST', '/v1/webhook-endpoints', manage, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
  });

  it('needs a program key with the webhooks scope', async () => {
    const noScope = await t.keyFor('prg_1', ['quotes:read']);
    const noProgram = await t.keyFor(null, ['webhooks:manage']);
    const body = { url: 'https://hooks.example.test/x', events: ['quote.created'] };
    expect((await call('POST', '/v1/webhook-endpoints', noScope, body)).statusCode).toBe(403);
    expect((await call('POST', '/v1/webhook-endpoints', noProgram, body)).statusCode).toBe(403);
  });

  it('deactivates an endpoint and keeps programs apart', async () => {
    const endpoint = await register(['quote.created']);
    expect((await call('DELETE', `/v1/webhook-endpoints/${endpoint.id}`, manage2)).statusCode).toBe(
      404,
    );
    expect((await call('DELETE', `/v1/webhook-endpoints/${endpoint.id}`)).statusCode).toBe(204);
    const row = await t.db
      .selectFrom('webhook_endpoint')
      .select('active')
      .where('id', '=', endpoint.id)
      .executeTakeFirstOrThrow();
    expect(row.active).toBe(false);
  });
});

describe('fan-out', () => {
  it('queues one delivery per active endpoint of the program that subscribes to the event', async () => {
    const a = await register(['quote.created', 'quote.referred']);
    const b = await register(['quote.referred']);
    const c = await register(['quote.created'], manage2);
    const d = await register(['quote.created']);
    await call('DELETE', `/v1/webhook-endpoints/${d.id}`);
    const event = await emit('quote.created');
    const rows = await deliveriesOf(event.id);
    const targeted = rows.map((r) => r.endpoint_id);
    expect(targeted).toContain(a.id);
    expect(targeted).not.toContain(b.id); // not subscribed
    expect(targeted).not.toContain(c.id); // another program
    expect(targeted).not.toContain(d.id); // inactive
    expect(rows.every((r) => r.state === 'pending' && r.attempt === 0)).toBe(true);
  });

  it('never delivers webhook.delivery.failed events', async () => {
    await t.db
      .insertInto('webhook_endpoint')
      .values({
        id: 'whe_loop',
        program_id: 'prg_1',
        url: 'https://hooks.example.test/loop',
        secret: 's',
        events: ['webhook.delivery.failed'],
      })
      .execute();
    const event = await t.db
      .transaction()
      .execute((trx) =>
        appendEvent(trx, { type: 'webhook.delivery.failed', programId: 'prg_1', data: {} }),
      );
    await t.drain();
    expect(await deliveriesOf(event.id)).toEqual([]);
  });
});

describe('delivery', () => {
  it('sends a signed body and marks the delivery delivered', async () => {
    const endpoint = await register(['quote.referred']);
    const event = await emit('quote.referred');
    t.http.calls.length = 0;
    expect(await t.deliver()).toBeGreaterThan(0);
    const sent = t.http.calls.find((c) => c.url === endpoint.url);
    expect(sent).toBeDefined();
    const header = sent?.headers['x-signature'] ?? '';
    expect(
      verify(endpoint.secret, header, sent?.body ?? '', Math.floor(NOW.getTime() / 1000), 300),
    ).toBe(true);
    expect(sent?.headers).toMatchObject({
      'x-event-id': event.id,
      'x-event-type': 'quote.referred',
      'content-type': 'application/json',
    });
    expect(JSON.parse(sent?.body ?? '{}')).toMatchObject({
      id: event.id,
      type: 'quote.referred',
      programId: 'prg_1',
      data: { quoteId: 'qte_x' },
    });
    const row = (await deliveriesOf(event.id)).find((r) => r.endpoint_id === endpoint.id);
    expect(row).toMatchObject({
      state: 'delivered',
      attempt: 1,
      last_status: 200,
      last_error: null,
    });
  });

  it('retries a 5xx later, with backoff, and delivers on the next try', async () => {
    const endpoint = await register(['quote.created']);
    const event = await emit();
    t.http.handler = () => 503;
    await t.deliver();
    let row = (await deliveriesOf(event.id)).find((r) => r.endpoint_id === endpoint.id);
    expect(row).toMatchObject({ state: 'pending', attempt: 1, last_status: 503 });
    expect(row?.next_attempt_at.getTime()).toBe(NOW.getTime() + 30_000); // rand = 1: the full first delay

    const before = t.http.calls.length;
    later(10);
    await t.deliver();
    expect(t.http.calls.length).toBe(before); // not due yet

    later(31);
    t.http.handler = () => 200;
    await t.deliver();
    row = (await deliveriesOf(event.id)).find((r) => r.endpoint_id === endpoint.id);
    expect(row).toMatchObject({ state: 'delivered', attempt: 2 });
    t.now.value = NOW;
  });

  it('retries a network error and a 429', async () => {
    const endpoint = await register(['quote.created']);
    const event = await emit();
    for (const outcome of [new Error('connection reset'), 429]) {
      t.http.handler = () => outcome;
      await t.deliver();
      const row = (await deliveriesOf(event.id)).find((r) => r.endpoint_id === endpoint.id);
      expect(row?.state).toBe('pending');
      later(((row?.attempt ?? 0) + 1) * 3600);
    }
    t.http.handler = () => 200;
    t.now.value = NOW;
  });

  it('does not retry a 4xx: it is a failure at once and announces it', async () => {
    const endpoint = await register(['quote.created']);
    const event = await emit();
    t.http.handler = () => 400;
    const before = (await failedEvents()).length;
    await t.deliver();
    const row = (await deliveriesOf(event.id)).find((r) => r.endpoint_id === endpoint.id);
    expect(row).toMatchObject({ state: 'dead', attempt: 1, last_status: 400 });
    const failed = await failedEvents();
    expect(failed.length).toBe(before + 1);
    expect(failed.at(-1)).toMatchObject({ deliveryId: row?.id });
    const calls = t.http.calls.length;
    later(7200);
    await t.deliver();
    expect(t.http.calls.length).toBe(calls);
    t.http.handler = () => 200;
    t.now.value = NOW;
  });

  it('gives up after the eighth attempt and announces the failure once', async () => {
    const endpoint = await register(['quote.created']);
    const event = await emit();
    t.http.handler = () => 500;
    const before = (await failedEvents()).length;
    for (let i = 0; i < MAX_DELIVERY_ATTEMPTS + 2; i++) {
      await t.deliver();
      later((i + 1) * 4000); // far beyond any backoff
    }
    const row = (await deliveriesOf(event.id)).find((r) => r.endpoint_id === endpoint.id);
    expect(row).toMatchObject({ state: 'dead', attempt: MAX_DELIVERY_ATTEMPTS });
    expect(t.http.calls.filter((c) => c.url === endpoint.url)).toHaveLength(MAX_DELIVERY_ATTEMPTS);
    expect((await failedEvents()).length).toBe(before + 1);
    t.http.handler = () => 200;
    t.now.value = NOW;
  });

  it('marks a delivery for a deactivated endpoint as failed without calling it', async () => {
    const endpoint = await register(['quote.created']);
    const event = await emit();
    await call('DELETE', `/v1/webhook-endpoints/${endpoint.id}`);
    const before = t.http.calls.length;
    await t.deliver();
    const row = (await deliveriesOf(event.id)).find((r) => r.endpoint_id === endpoint.id);
    expect(row).toMatchObject({ state: 'dead', last_error: 'the endpoint was deactivated' });
    expect(t.http.calls.filter((c) => c.url === endpoint.url)).toHaveLength(0);
    expect(t.http.calls.length).toBeGreaterThanOrEqual(before);
  });

  it('lets two workers take turns: each delivery is sent once', async () => {
    const endpoint = await register(['quote.created']);
    const event = await emit();
    t.http.handler = async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return 200;
    };
    const before = t.http.calls.filter((c) => c.url === endpoint.url).length;
    await Promise.all([t.deliver(), t.deliver()]);
    expect(t.http.calls.filter((c) => c.url === endpoint.url).length - before).toBe(1);
    expect((await deliveriesOf(event.id)).find((r) => r.endpoint_id === endpoint.id)?.state).toBe(
      'delivered',
    );
    t.http.handler = () => 200;
  });
});

describe('inspection and replay', () => {
  it('lists the deliveries of the program', async () => {
    const endpoint = await register(['quote.created']);
    const event = await emit();
    const mine = (await call('GET', `/v1/webhook-deliveries?endpointId=${endpoint.id}`)).json()
      .deliveries;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      endpointId: endpoint.id,
      eventId: event.id,
      eventType: 'quote.created',
      state: 'pending',
    });
    const others = (
      await call('GET', `/v1/webhook-deliveries?endpointId=${endpoint.id}`, manage2)
    ).json().deliveries;
    expect(others).toEqual([]);
  });

  it('replays a failed delivery with the same event id', async () => {
    const endpoint = await register(['quote.created']);
    const event = await emit();
    t.http.handler = () => 400;
    await t.deliver();
    const row = (await deliveriesOf(event.id)).find((r) => r.endpoint_id === endpoint.id);
    expect(row?.state).toBe('dead');

    t.http.handler = () => 200;
    const replay = await call('POST', `/v1/webhook-deliveries/${row?.id}/replay`);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ state: 'pending', attempt: 0, eventId: event.id });
    t.http.calls.length = 0;
    await t.deliver();
    const sent = t.http.calls.find((c) => c.url === endpoint.url);
    expect(JSON.parse(sent?.body ?? '{}').id).toBe(event.id);
    expect((await deliveriesOf(event.id)).find((r) => r.endpoint_id === endpoint.id)?.state).toBe(
      'delivered',
    );
  });

  it('refuses to replay a delivery that is still in progress and hides other programs', async () => {
    const endpoint = await register(['quote.created']);
    const event = await emit();
    const row = (await deliveriesOf(event.id)).find((r) => r.endpoint_id === endpoint.id);
    const busy = await call('POST', `/v1/webhook-deliveries/${row?.id}/replay`);
    expect(busy.statusCode).toBe(409);
    expect(busy.json().error.code).toBe('delivery_in_progress');
    expect(
      (await call('POST', `/v1/webhook-deliveries/${row?.id}/replay`, manage2)).statusCode,
    ).toBe(404);
  });
});

describe('the real HTTP client', () => {
  it('refuses a private target unless told otherwise', async () => {
    await expect(
      createFetchClient().post('https://127.0.0.1:9/hook', {
        headers: {},
        body: '{}',
        timeoutMs: 500,
      }),
    ).rejects.toThrow(/not public/);
    await expect(
      createFetchClient().post('https://[::1]:9/hook', { headers: {}, body: '{}', timeoutMs: 500 }),
    ).rejects.toThrow(/not public/);
  });

  it('posts, reports the status and does not follow redirects', async () => {
    const seen: { body: string; signature: string | undefined }[] = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        seen.push({ body, signature: req.headers['x-signature'] as string | undefined });
        if (req.url === '/redirect') {
          res.writeHead(302, { location: 'http://127.0.0.1:1/elsewhere' }).end();
        } else {
          res.writeHead(204).end();
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const client = createFetchClient({ allowPrivateTargets: true });
      const ok = await client.post(`http://127.0.0.1:${port}/hook`, {
        headers: { 'x-signature': 't=1,v1=ab' },
        body: '{"a":1}',
        timeoutMs: 2000,
      });
      expect(ok.status).toBe(204);
      expect(seen[0]).toEqual({ body: '{"a":1}', signature: 't=1,v1=ab' });
      const redirected = await client.post(`http://127.0.0.1:${port}/redirect`, {
        headers: {},
        body: '{}',
        timeoutMs: 2000,
      });
      expect(redirected.status).toBe(302);
      expect(seen).toHaveLength(2);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('gives up after the timeout', async () => {
    const server = createServer(() => {});
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      await expect(
        createFetchClient({ allowPrivateTargets: true }).post(`http://127.0.0.1:${port}/slow`, {
          headers: {},
          body: '{}',
          timeoutMs: 100,
        }),
      ).rejects.toThrow();
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
