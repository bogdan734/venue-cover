import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/app.js';

let t: TestApp;
let operator: string;
let counter = 0;

beforeAll(async () => {
  t = await createTestApp();
  operator = await t.keyFor(null, ['programs:manage', 'reports:read']);
});
afterAll(() => t.close());

const send = (method: 'GET' | 'POST', url: string, key: string, payload?: object) =>
  t.app.inject({
    method,
    url,
    headers: {
      authorization: `Bearer ${key}`,
      ...(method === 'POST' ? { 'idempotency-key': `a-${++counter}` } : {}),
    },
    ...(payload ? { payload } : {}),
  });

describe('a client console link', () => {
  it('opens its own program only, says when it was last used, and stops when revoked', async () => {
    const made = await send('POST', '/v1/programs/prg_2/access', operator, {
      label: 'Facilities office',
    });
    expect(made.statusCode).toBe(201);
    const { id, token } = made.json();
    expect(token).toMatch(/^ca_[A-Za-z0-9_-]{32}$/);

    const opened = await send('POST', '/v1/access/resolve', operator, { token });
    expect(opened.json()).toMatchObject({ programId: 'prg_2', code: 'RVT', accessId: id });

    const listed = (await send('GET', '/v1/programs/prg_2/access', operator)).json().links;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id, label: 'Facilities office', revokedAt: null });
    expect(listed[0].lastUsedAt).not.toBeNull();
    expect(JSON.stringify(listed)).not.toContain(token); // the link is shown once, when it is made

    expect(
      (await send('POST', `/v1/programs/prg_2/access/${id}/revoke`, operator)).statusCode,
    ).toBe(200);
    expect((await send('POST', '/v1/access/resolve', operator, { token })).statusCode).toBe(404);

    const log = (await send('GET', '/v1/programs/prg_2/audit', operator)).json().entries;
    expect(log.slice(0, 2).map((e: { action: string }) => e.action)).toEqual([
      'access.revoked',
      'access.created',
    ]);
  });

  it('cannot be revoked through another program', async () => {
    const { id } = (
      await send('POST', '/v1/programs/prg_1/access', operator, { label: 'Front desk' })
    ).json();
    expect(
      (await send('POST', `/v1/programs/prg_2/access/${id}/revoke`, operator)).statusCode,
    ).toBe(404);
  });

  it('is resolved only by the operator', async () => {
    const program = await t.keyFor('prg_1', ['programs:manage']);
    expect((await send('POST', '/v1/access/resolve', program, { token: 'ca_x' })).statusCode).toBe(
      403,
    );
    expect(
      (await send('POST', '/v1/programs/prg_1/access', program, { label: 'x' })).statusCode,
    ).toBe(403);
  });
});

describe('the hub for one client', () => {
  it('gives a program key its own row only', async () => {
    const client = await t.keyFor('prg_3', ['reports:read']);
    const { clients } = (await send('GET', '/v1/hub/clients', client)).json();
    expect(clients.map((c: { program: { id: string } }) => c.program.id)).toEqual(['prg_3']);
  });
});
