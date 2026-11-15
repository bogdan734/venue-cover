import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, NOW, type TestApp } from '../../../test/app.js';

let t: TestApp;
let creator: string;
let uw1: string;
let uw2: string;
let uwProgram2: string;
let hockey: string;
let counter = 0;

beforeAll(async () => {
  t = await createTestApp();
  creator = await t.keyFor('prg_1', ['quotes:read', 'quotes:write']);
  uw1 = await t.keyFor(null, ['referrals:decide']);
  uw2 = await t.keyFor(null, ['referrals:decide']);
  uwProgram2 = await t.keyFor('prg_2', ['referrals:decide']);
  hockey = await t.activityId('Ice hockey game');
});
afterAll(() => t.close());

const send = (method: 'GET' | 'POST', url: string, key: string, payload?: object, idem?: string) =>
  t.app.inject({
    method,
    url,
    headers: {
      authorization: `Bearer ${key}`,
      ...(method === 'POST' && url.endsWith('/decision')
        ? { 'idempotency-key': idem ?? `d-${++counter}` }
        : {}),
      ...(method === 'POST' && url === '/v1/quotes' ? { 'idempotency-key': `q-${++counter}` } : {}),
      ...(method === 'POST' && url.endsWith('/bind')
        ? { 'idempotency-key': `b-${++counter}` }
        : {}),
    },
    ...(payload ? { payload } : {}),
  });

// A class C event in a program that only automates up to class B: priced, but referred.
async function referredQuote(over: Record<string, unknown> = {}) {
  const res = await send('POST', '/v1/quotes', creator, {
    activityId: hockey,
    participants: 40,
    hours: 2,
    alcohol: 'none',
    eventDate: '2026-12-20',
    startTime: '18:00',
    limitCents: 200_000_000,
    holder: { name: 'Pat Example', email: 'pat@example.org' },
    ...over,
  });
  expect(res.statusCode).toBe(201);
  const quote = res.json();
  const referral = await t.db
    .selectFrom('referral')
    .select('id')
    .where('quote_id', '=', quote.id)
    .executeTakeFirstOrThrow();
  return { quote, referralId: referral.id };
}
const claim = (id: string, key = uw1) => send('POST', `/v1/referrals/${id}/claim`, key);
const decide = (id: string, body: object, key = uw1, idem?: string) =>
  send('POST', `/v1/referrals/${id}/decision`, key, body, idem);
const quoteOf = async (id: string) => (await send('GET', `/v1/quotes/${id}`, creator)).json();
const outbox = async (type: string) =>
  (await t.db.selectFrom('outbox_event').select('seq').where('type', '=', type).execute()).length;

describe('the queue', () => {
  it('lists open referrals, earliest deadline first, with the quote and an sla', async () => {
    const first = await referredQuote();
    t.now.value = new Date(NOW.getTime() + 3600_000);
    const second = await referredQuote();
    t.now.value = NOW;
    const res = await send('GET', '/v1/referrals', uw1);
    expect(res.statusCode).toBe(200);
    const ours = res
      .json()
      .referrals.filter((r: { id: string }) =>
        [first.referralId, second.referralId].includes(r.id),
      );
    expect(ours.map((r: { id: string }) => r.id)).toEqual([first.referralId, second.referralId]);
    expect(ours[0]).toMatchObject({
      state: 'open',
      reasons: ['PROGRAM_RULE'],
      sla: 'ok',
      activity: { title: 'Ice hockey game', riskClass: 'C' },
      quote: { id: first.quote.id, state: 'referred' },
    });
    expect(ours[0].quote.premium.totalCents).toBeGreaterThan(0);
  });

  it('flags a referral as due soon within four hours of its deadline and overdue after it', async () => {
    const { referralId } = await referredQuote();
    const slaAt = async (hoursLater: number) => {
      t.now.value = new Date(NOW.getTime() + hoursLater * 3600_000);
      try {
        const body = (await send('GET', `/v1/referrals/${referralId}`, uw1)).json();
        return body.sla;
      } finally {
        t.now.value = NOW;
      }
    };
    expect(await slaAt(19)).toBe('ok');
    expect(await slaAt(20)).toBe('due_soon');
    expect(await slaAt(24)).toBe('due_soon');
    expect(await slaAt(25)).toBe('overdue');
  });

  it('shows the classification behind a referral', async () => {
    t.llm.handler = () => ({
      activities: ['hockey game'],
      participants: 40,
      hours: 2,
      alcohol: 'none',
      flags: [],
    });
    const classified = (
      await t.app.inject({
        method: 'POST',
        url: '/v1/intake/classify',
        headers: { authorization: `Bearer ${creator}` },
        payload: { text: 'Hockey game for 40 people, 2 hours, call 416-555-0199' },
      })
    ).json();
    const { referralId } = await referredQuote({ classificationId: classified.id });
    const detail = (await send('GET', `/v1/referrals/${referralId}`, uw1)).json();
    expect(detail.classification).toMatchObject({ id: classified.id, degraded: false });
    expect(detail.classification.maskedText).toMatch(/\[PHONE#[A-Z2-7]{6}\]/);
    expect(detail.classification.phrases[0].candidates.length).toBeGreaterThan(0);
    // This underwriter's key may not see personal details; one that may gets the description as written.
    expect(detail.classification.text).toBeNull();
    const trusted = await t.keyFor(null, ['referrals:decide', 'personal:read']);
    const shown = (await send('GET', `/v1/referrals/${referralId}`, trusted)).json();
    expect(shown.classification.text).toBe('Hockey game for 40 people, 2 hours, call 416-555-0199');
  });

  it('keeps programs apart', async () => {
    const { referralId } = await referredQuote();
    expect((await send('GET', `/v1/referrals/${referralId}`, uwProgram2)).statusCode).toBe(404);
    expect((await claim(referralId, uwProgram2)).statusCode).toBe(404);
    const list = (await send('GET', '/v1/referrals', uwProgram2)).json().referrals;
    expect(list.map((r: { id: string }) => r.id)).not.toContain(referralId);
    expect((await send('GET', `/v1/referrals/${referralId}`, creator)).statusCode).toBe(403);
  });
});

describe('claiming', () => {
  it('lets only one underwriter hold a referral', async () => {
    const { referralId } = await referredQuote();
    const first = await claim(referralId, uw1);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ state: 'claimed' });
    const other = await claim(referralId, uw2);
    expect(other.statusCode).toBe(409);
    expect(other.json().error.code).toBe('already_claimed');
    expect((await claim(referralId, uw1)).statusCode).toBe(200);
  });

  it('lets one of two simultaneous claims win', async () => {
    const { referralId } = await referredQuote();
    const [a, b] = await Promise.all([claim(referralId, uw1), claim(referralId, uw2)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
  });
});

describe('deciding', () => {
  it('needs a claim by the same underwriter', async () => {
    const { referralId } = await referredQuote();
    const unclaimed = await decide(referralId, { action: 'approve', note: 'fine' });
    expect(unclaimed.statusCode).toBe(409);
    expect(unclaimed.json().error.code).toBe('not_claimed_by_you');
    await claim(referralId, uw1);
    expect((await decide(referralId, { action: 'approve', note: 'fine' }, uw2)).statusCode).toBe(
      409,
    );
  });

  it('approves at the indicative price, returns the quote to quoted and lets it bind', async () => {
    const { quote, referralId } = await referredQuote();
    await claim(referralId);
    const before = await outbox('referral.decided');
    const res = await decide(referralId, { action: 'approve', note: 'standard league night' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ state: 'decided', quote: { state: 'quoted' } });
    const after = await quoteOf(quote.id);
    expect(after.state).toBe('quoted');
    expect(after.premium).toEqual(quote.premium);
    expect(new Date(after.expiresAt).getTime()).toBeGreaterThanOrEqual(
      new Date(quote.expiresAt).getTime(),
    );
    expect(await outbox('referral.decided')).toBe(before + 1);
    const bound = await send('POST', `/v1/quotes/${quote.id}/bind`, creator, {
      paymentToken: 'tok_ok',
    });
    expect(bound.statusCode).toBe(200);
  });

  it('reprices at the class the underwriter chooses', async () => {
    const { quote, referralId } = await referredQuote();
    await claim(referralId);
    const res = await decide(referralId, {
      action: 'approve_with_override',
      riskClass: 'B',
      note: 'recreational, no contact',
    });
    expect(res.statusCode).toBe(200);
    const after = await quoteOf(quote.id);
    expect(after.state).toBe('quoted');
    expect(after.premium.netCents).toBeLessThan(quote.premium.netCents);
    expect(after.premium.rateRowId).not.toBe(quote.premium.rateRowId);
    const row = await t.db
      .selectFrom('rate_row')
      .select('risk_class')
      .where('id', '=', after.premium.rateRowId)
      .executeTakeFirstOrThrow();
    expect(row.risk_class).toBe('B');
  });

  it('reprices at another activity and keeps the product consistent', async () => {
    const { quote, referralId } = await referredQuote();
    await claim(referralId);
    const zumba = await t.activityId('Zumba');
    await decide(referralId, {
      action: 'approve_with_override',
      activityId: zumba,
      note: 'it is a fitness class',
    });
    const after = await quoteOf(quote.id);
    expect(after).toMatchObject({ state: 'quoted', activityId: zumba });
    expect(after.premium.netCents).toBeLessThan(quote.premium.netCents);
  });

  it('declines and ends the quote', async () => {
    const { quote, referralId } = await referredQuote();
    await claim(referralId);
    const res = await decide(referralId, {
      action: 'decline',
      note: 'contact sport, not insurable here',
    });
    expect(res.statusCode).toBe(200);
    expect((await quoteOf(quote.id)).state).toBe('declined');
    const bind = await send('POST', `/v1/quotes/${quote.id}/bind`, creator, {
      paymentToken: 'tok_ok',
    });
    expect(bind.statusCode).toBe(409);
  });

  it('needs an override to approve a quote that has no price', async () => {
    const fireworks = await t.activityId('Fireworks display');
    const { quote, referralId } = await referredQuote({ activityId: fireworks });
    expect(quote.premium).toBeNull();
    await claim(referralId);
    const plain = await decide(referralId, { action: 'approve', note: 'ok' });
    expect(plain.statusCode).toBe(409);
    expect(plain.json().error.code).toBe('no_price');
    const birthday = await t.activityId('Birthday party');
    const fixed = await decide(referralId, {
      action: 'approve_with_override',
      activityId: birthday,
      note: 'it is a birthday',
    });
    expect(fixed.statusCode).toBe(200);
    expect((await quoteOf(quote.id)).premium.totalCents).toBeGreaterThan(0);
  });

  it('does not decide twice', async () => {
    const { referralId } = await referredQuote();
    await claim(referralId);
    await decide(referralId, { action: 'approve', note: 'ok' });
    const again = await decide(referralId, { action: 'decline', note: 'changed my mind' });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('already_decided');
  });

  it('does not approve a quote that has expired', async () => {
    const { referralId } = await referredQuote();
    await claim(referralId);
    t.now.value = new Date(NOW.getTime() + 31 * 24 * 3600_000);
    try {
      const res = await decide(referralId, { action: 'approve', note: 'late' });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('quote_expired');
    } finally {
      t.now.value = NOW;
    }
  });

  it('validates the decision', async () => {
    const { referralId } = await referredQuote();
    await claim(referralId);
    for (const body of [
      { action: 'approve_with_override', note: 'no change given' },
      { action: 'approve', riskClass: 'B', note: 'approve cannot override' },
      { action: 'decline', activityId: 'act_x', note: 'decline cannot override' },
      { action: 'approve' },
      { action: 'approve_with_override', riskClass: 'X', note: 'x' },
      { action: 'maybe', note: 'x' },
    ]) {
      const res = await decide(referralId, body);
      expect(res.statusCode).toBe(400);
    }
  });

  it('replays the same response for the same Idempotency-Key and records one decision', async () => {
    const { quote, referralId } = await referredQuote();
    await claim(referralId);
    const first = await decide(referralId, { action: 'approve', note: 'ok' }, uw1, 'same-decision');
    const second = await decide(
      referralId,
      { action: 'approve', note: 'ok' },
      uw1,
      'same-decision',
    );
    expect(second.json()).toEqual(first.json());
    const labelled = await t.db
      .selectFrom('labelled_example')
      .select('id')
      .where('text', '=', 'Ice hockey game')
      .execute();
    expect(labelled.length).toBeGreaterThan(0);
    expect((await quoteOf(quote.id)).state).toBe('quoted');
  });
});

describe('learning from decisions', () => {
  it('stores every decision as a labelled example', async () => {
    const { referralId } = await referredQuote();
    await claim(referralId);
    const zumba = await t.activityId('Zumba');
    await decide(referralId, {
      action: 'approve_with_override',
      activityId: zumba,
      riskClass: 'A',
      note: 'fitness',
    });
    const row = await t.db
      .selectFrom('labelled_example')
      .selectAll()
      .where('source', '=', 'underwriter')
      .where('activity_id', '=', zumba)
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({ text: 'Ice hockey game', risk_class: 'A', source: 'underwriter' });
  });

  it('labels the description when the quote came from one, and a decline as excluded', async () => {
    t.llm.handler = () => ({
      activities: ['hockey game'],
      participants: 40,
      hours: 2,
      alcohol: 'none',
      flags: [],
    });
    const classified = (
      await t.app.inject({
        method: 'POST',
        url: '/v1/intake/classify',
        headers: { authorization: `Bearer ${creator}` },
        payload: { text: 'Friendly hockey game, 40 people, 2 hours' },
      })
    ).json();
    const { referralId } = await referredQuote({ classificationId: classified.id });
    await claim(referralId);
    await decide(referralId, { action: 'decline', note: 'too rough' });
    const row = await t.db
      .selectFrom('labelled_example')
      .selectAll()
      .where('text', '=', 'Friendly hockey game, 40 people, 2 hours')
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({ risk_class: 'X', source: 'underwriter' });
  });
});
