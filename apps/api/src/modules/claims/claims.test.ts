import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/app.js';

let t: TestApp;
let writer: string; // program 1: reports and reads claims, manages webhooks
let other: string; // program 2
let policy: { policyId: string; policyNumber: string };
let counter = 0;

beforeAll(async () => {
  t = await createTestApp();
  writer = await t.keyFor('prg_1', [
    'quotes:read',
    'quotes:write',
    'webhooks:manage',
    'personal:read',
  ]);
  other = await t.keyFor('prg_2', ['quotes:read', 'quotes:write']);
  policy = await t.bindPolicy('prg_1', { eventDate: '2026-12-20', startTime: '18:00', hours: 4 });
});
afterAll(() => t.close());

const notice = (over: Record<string, unknown> = {}) => ({
  policyId: policy.policyId,
  lossDate: '2026-12-20',
  description: 'A guest slipped on a wet floor near the buffet and hurt a wrist.',
  reporter: { name: 'Sam Reporter', email: 'sam@example.org' },
  ...over,
});

const report = (body: object, key = writer, idem = `c-${++counter}`) =>
  t.app.inject({
    method: 'POST',
    url: '/v1/claims',
    headers: { authorization: `Bearer ${key}`, ...(idem ? { 'idempotency-key': idem } : {}) },
    payload: body,
  });
const read = (id: string, key = writer) =>
  t.app.inject({
    method: 'GET',
    url: `/v1/claims/${id}`,
    headers: { authorization: `Bearer ${key}` },
  });

describe('POST /v1/claims', () => {
  it('takes a loss that happened during the policy period, and reads it back', async () => {
    const created = await report(notice());
    expect(created.statusCode).toBe(201);
    const { claimId } = created.json();
    expect(claimId).toMatch(/^clm_/);
    const view = (await read(claimId)).json();
    expect(view).toMatchObject({
      id: claimId,
      policyId: policy.policyId,
      policyNumber: policy.policyNumber,
      lossDate: '2026-12-20',
      reporter: { name: 'Sam Reporter', email: 'sam@example.org' },
    });
    expect(view.description).toContain('wet floor');
  });

  it('rejects a loss date outside the policy period, and counts the night after an evening event', async () => {
    for (const lossDate of ['2026-12-19', '2026-12-21']) {
      const res = await report(notice({ lossDate }));
      expect(res.statusCode, lossDate).toBe(422);
      expect(res.json().error.code).toBe('loss_outside_policy_period');
      expect(res.json().error.message).toContain('2026-12-20');
    }
    const late = await t.bindPolicy('prg_1', {
      eventDate: '2026-12-22',
      startTime: '20:00',
      hours: 8,
    });
    const nextMorning = await report(notice({ policyId: late.policyId, lossDate: '2026-12-23' }));
    expect(nextMorning.statusCode).toBe(201); // the event ran until 04:00
    expect(
      (await report(notice({ policyId: late.policyId, lossDate: '2026-12-24' }))).statusCode,
    ).toBe(422);
  });

  it('refuses a date that is not on the calendar, a thin description and a bad address', async () => {
    const bad = [
      notice({ lossDate: '2026-02-30' }),
      notice({ lossDate: '20 Dec 2026' }),
      notice({ description: 'hurt' }),
      notice({ reporter: { name: 'Sam', email: 'not-an-address' } }),
      notice({ reporter: { name: '', email: 'sam@example.org' } }),
      notice({ policyId: '' }),
    ];
    for (const body of bad) {
      const res = await report(body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json().error.code).toBe('validation_error');
    }
  });

  it('creates one claim per Idempotency-Key', async () => {
    const before = await t.db.selectFrom('claim').select('id').execute();
    const first = await report(
      notice({ description: 'Once only: a chair collapsed during the speeches.' }),
      writer,
      'same-key',
    );
    const second = await report(
      notice({ description: 'Once only: a chair collapsed during the speeches.' }),
      writer,
      'same-key',
    );
    expect(second.json()).toEqual(first.json());
    expect((await t.db.selectFrom('claim').select('id').execute()).length).toBe(before.length + 1);

    const different = await report(
      notice({ description: 'A different story under the same key.' }),
      writer,
      'same-key',
    );
    expect(different.statusCode).toBe(409);
    expect(different.json().error.code).toBe('idempotency_key_reused');

    const missing = await report(notice(), writer, '');
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.code).toBe('idempotency_key_required');
  });

  it('needs the write scope and a program’s own policy', async () => {
    const readOnly = await t.keyFor('prg_1', ['quotes:read']);
    expect((await report(notice(), readOnly)).statusCode).toBe(403);
    const stranger = await report(notice(), other);
    expect(stranger.statusCode).toBe(404);
    expect(stranger.json().error.code).toBe('policy_not_found');
    const unknown = await report(notice({ policyId: 'pol_nope' }));
    expect(unknown.statusCode).toBe(404);
    const anonymous = await t.app.inject({ method: 'POST', url: '/v1/claims', payload: notice() });
    expect(anonymous.statusCode).toBe(401);
  });
});

describe('GET /v1/claims/:id', () => {
  it('shows a claim to its own program and to a key without a program, and to nobody else', async () => {
    const { claimId } = (
      await report(notice({ description: 'Seen by the owners only, nobody else.' }))
    ).json();
    expect((await read(claimId, writer)).statusCode).toBe(200);
    expect((await read(claimId, await t.keyFor(null, ['quotes:read']))).statusCode).toBe(200);
    const stranger = await read(claimId, await t.keyFor('prg_2', ['quotes:read']));
    expect(stranger.statusCode).toBe(404);
    expect(stranger.json().error.code).toBe('claim_not_found');
    expect((await read('clm_nope')).statusCode).toBe(404);
  });
});

describe('claim.reported', () => {
  it('is delivered to endpoints subscribed to it, with ids and the date but not the story', async () => {
    await t.drain(); // claims reported earlier are not this endpoint's business
    const registered = await t.app.inject({
      method: 'POST',
      url: '/v1/webhook-endpoints',
      headers: { authorization: `Bearer ${writer}` },
      payload: { url: 'https://hooks.example.test/claims', events: ['claim.reported'] },
    });
    expect(registered.statusCode).toBe(201);
    t.http.calls.length = 0;
    const { claimId } = (
      await report(notice({ description: 'Private detail: a guest was taken to hospital.' }))
    ).json();
    await t.drain();
    await t.deliver();
    const sent = t.http.calls.filter((c) => c.url === 'https://hooks.example.test/claims');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.headers['x-event-type']).toBe('claim.reported');
    const body = JSON.parse(sent[0]?.body ?? '{}');
    expect(body).toMatchObject({
      type: 'claim.reported',
      programId: 'prg_1',
      data: {
        claimId,
        policyId: policy.policyId,
        policyNumber: policy.policyNumber,
        lossDate: '2026-12-20',
      },
    });
    expect(sent[0]?.body).not.toContain('hospital');
    expect(sent[0]?.body).not.toContain('sam@example.org');
  });
});
