import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/app.js';
import { verify } from './index.js';

let t: TestApp;
let key: string;
beforeAll(async () => {
  t = await createTestApp();
  key = await t.keyFor('prg_1', ['webhooks:manage']);
});
afterAll(() => t.close());

const call = (method: 'GET' | 'POST', url: string, payload?: object, as = key) =>
  t.app.inject({
    method,
    url,
    headers: {
      authorization: `Bearer ${as}`,
      ...(url.endsWith('/test') ? { 'idempotency-key': `${url}-${Math.random()}` } : {}),
    },
    ...(payload ? { payload } : {}),
  });

describe('a test event', () => {
  it('goes to the one endpoint it was asked for, signed like any other', async () => {
    const one = (
      await call('POST', '/v1/webhook-endpoints', {
        url: 'https://receiver.example/one',
        events: ['policy.issued'],
      })
    ).json();
    await call('POST', '/v1/webhook-endpoints', {
      url: 'https://receiver.example/other',
      events: ['policy.issued'],
    });

    const sent = await call('POST', `/v1/webhook-endpoints/${one.id}/test`);
    expect(sent.statusCode).toBe(202);
    await t.deliver();

    const calls = t.http.calls.filter((c) => c.url.startsWith('https://receiver.example/'));
    expect(calls.map((c) => c.url)).toEqual(['https://receiver.example/one']);
    const body = JSON.parse(calls[0]?.body ?? '{}');
    expect(body).toMatchObject({ type: 'webhook.test', data: { endpointId: one.id } });
    const signed = calls[0] as { headers: Record<string, string>; body: string };
    const now = Math.floor(t.now.value.getTime() / 1000);
    expect(verify(one.secret, signed.headers['x-signature'] ?? '', signed.body, now, 300)).toBe(
      true,
    );

    const deliveries = (await call('GET', `/v1/webhook-deliveries?endpointId=${one.id}`)).json()
      .deliveries;
    expect(deliveries[0]).toMatchObject({ state: 'delivered', eventType: 'webhook.test' });
  });

  it('is not sent to another program’s endpoint', async () => {
    const other = await t.keyFor('prg_2', ['webhooks:manage']);
    const theirs = (
      await call(
        'POST',
        '/v1/webhook-endpoints',
        { url: 'https://receiver.example/theirs', events: ['policy.issued'] },
        other,
      )
    ).json();
    expect((await call('POST', `/v1/webhook-endpoints/${theirs.id}/test`)).statusCode).toBe(404);
  });
});
