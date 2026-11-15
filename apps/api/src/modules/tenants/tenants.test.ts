import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/app.js';

let t: TestApp;
let operator: string; // runs the hub
let portal: string; // program 1's portal
let counter = 0;

beforeAll(async () => {
  t = await createTestApp();
  operator = await t.keyFor(null, ['programs:manage', 'reports:read', 'quotes:read']);
  portal = await t.keyFor('prg_1', ['quotes:read', 'quotes:write', 'personal:read']);
});
afterAll(() => t.close());

const send = (method: 'GET' | 'POST' | 'PUT', url: string, key: string, payload?: object) =>
  t.app.inject({
    method,
    url,
    headers: {
      authorization: `Bearer ${key}`,
      ...(method === 'POST' ? { 'idempotency-key': `t-${++counter}` } : {}),
    },
    ...(payload ? { payload } : {}),
  });

async function newProgram(code: string) {
  const options = (await send('GET', '/v1/program-options', operator)).json();
  const res = await send('POST', '/v1/programs', operator, {
    templateId: options.templates[0].id,
    name: `Test Halls ${code}`,
    code,
    province: 'ON',
    brokerId: options.brokers[0].id,
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

describe('a client program', () => {
  it('starts as a draft, moves only along its lifecycle, and every step is in the log', async () => {
    const id = await newProgram('TSTA');
    expect((await send('GET', `/v1/programs/${id}`, operator)).json().status).toBe('draft');

    const skip = await send('POST', `/v1/programs/${id}/status`, operator, { to: 'live' });
    expect(skip.statusCode).toBe(409);
    expect(skip.json().error.code).toBe('illegal_transition');
    for (const to of ['test', 'live', 'paused']) {
      expect((await send('POST', `/v1/programs/${id}/status`, operator, { to })).statusCode).toBe(
        200,
      );
    }

    const log = (await send('GET', `/v1/programs/${id}/audit`, operator)).json().entries;
    expect(log.map((e: { action: string }) => e.action)).toEqual([
      'status.changed',
      'status.changed',
      'status.changed',
      'program.created',
    ]);
    expect(log[0]).toMatchObject({ detail: { from: 'live', to: 'paused' }, actor: 'test' });
  });

  it('keeps an appearance only when it can be read, and its contacts', async () => {
    const id = await newProgram('TSTB');
    const unreadable = await send('PUT', `/v1/programs/${id}/appearance`, operator, {
      brand: '#f5c518',
      logo: null,
      tagline: 'Halls for every occasion',
      welcome: null,
    });
    expect(unreadable.statusCode).toBe(400);
    expect(unreadable.json().error.code).toBe('unreadable_theme');

    const theme = {
      brand: '#0f5c4a',
      logo: null,
      tagline: 'Halls for every occasion',
      welcome: 'Hi.',
    };
    expect((await send('PUT', `/v1/programs/${id}/appearance`, operator, theme)).statusCode).toBe(
      200,
    );
    const contacts = {
      supportEmail: 'help@halls.example',
      supportPhone: '+1 613 555 0100',
      telegram: '@halls_help_bot',
      hours: 'Weekdays 9 to 5',
    };
    expect((await send('PUT', `/v1/programs/${id}/contacts`, operator, contacts)).statusCode).toBe(
      200,
    );
    expect((await send('GET', `/v1/programs/${id}`, operator)).json()).toMatchObject({
      theme,
      contacts,
    });
  });

  it('takes no new quotes while paused, and does again when live', async () => {
    const id = await newProgram('TSTC');
    for (const to of ['test', 'live', 'paused'])
      await send('POST', `/v1/programs/${id}/status`, operator, { to });
    const key = await t.keyFor(id, ['quotes:read', 'quotes:write']);
    const quote = async () =>
      t.app.inject({
        method: 'POST',
        url: '/v1/quotes',
        headers: { authorization: `Bearer ${key}`, 'idempotency-key': `q-${++counter}` },
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
    const refused = await quote();
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('program_paused');
    await send('POST', `/v1/programs/${id}/status`, operator, { to: 'live' });
    expect([201, 400]).toContain((await quote()).statusCode); // not refused for the pause any more
  });
});

describe('the hub', () => {
  it('counts visits per day for the portal’s own program, and sums each client’s month', async () => {
    for (let i = 0; i < 3; i++) {
      expect((await send('POST', '/v1/visits', portal)).statusCode).toBe(204);
    }
    await t.bindPolicy('prg_1');
    const { clients } = (await send('GET', '/v1/hub/clients', operator)).json();
    const fhv = clients.find((c: { program: { id: string } }) => c.program.id === 'prg_1');
    expect(fhv.visits).toBeGreaterThanOrEqual(3);
    expect(fhv.policies).toBeGreaterThanOrEqual(1);
    expect(fhv.premiumCents).toBeGreaterThan(0);
    expect(fhv.daily).toHaveLength(30);
    expect(fhv.daily.at(-1)).toMatchObject({
      visits: expect.any(Number),
      policies: expect.any(Number),
    });
  });

  it('needs reports:read, and counts visits for a program’s own key only', async () => {
    expect((await send('GET', '/v1/hub/clients', portal)).statusCode).toBe(403);
    expect((await send('POST', '/v1/visits', operator)).statusCode).toBe(403);
  });
});
