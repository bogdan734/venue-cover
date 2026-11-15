import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/app.js';

let t: TestApp;
let creator: string;
let uw: string;
let uwProgram2: string;
let hockey: string;
let counter = 0;

beforeAll(async () => {
  t = await createTestApp();
  creator = await t.keyFor('prg_1', ['quotes:read', 'quotes:write']);
  uw = await t.keyFor(null, ['referrals:decide']);
  uwProgram2 = await t.keyFor('prg_2', ['referrals:decide']);
  hockey = await t.activityId('Ice hockey game');
});
afterAll(() => t.close());

const send = (method: 'GET' | 'POST', url: string, key: string, payload?: object) =>
  t.app.inject({
    method,
    url,
    headers: {
      authorization: `Bearer ${key}`,
      ...(method === 'POST' && (url.endsWith('/decision') || url === '/v1/quotes')
        ? { 'idempotency-key': `s-${++counter}` }
        : {}),
    },
    ...(payload ? { payload } : {}),
  });

async function referred(over: Record<string, unknown> = {}) {
  const res = await send('POST', '/v1/quotes', creator, {
    activityId: hockey,
    participants: 50,
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
  const row = await t.db
    .selectFrom('referral')
    .select('id')
    .where('quote_id', '=', quote.id)
    .executeTakeFirstOrThrow();
  return { quote, referralId: row.id };
}
const worksheet = (id: string, key = uw) => send('GET', `/v1/referrals/${id}/worksheet`, key);
const approve = async (id: string, body: object = { action: 'approve', note: 'ok' }) => {
  await send('POST', `/v1/referrals/${id}/claim`, uw);
  return send('POST', `/v1/referrals/${id}/decision`, uw, body);
};

describe('the worksheet', () => {
  it('starts from the rate card premium and proposes the same price for a plain event', async () => {
    const { quote, referralId } = await referred();
    const res = await worksheet(referralId);
    expect(res.statusCode).toBe(200);
    const ws = res.json();
    expect(ws.lines[0]).toMatchObject({ id: 'base', amountCents: quote.premium.netCents });
    expect(ws.lines.find((l: { id: string }) => l.id === 'attendance').amountCents).toBe(0);
    expect(ws.netTotalCents).toBe(quote.premium.netCents);
    expect(ws.proposed.totalCents).toBe(quote.premium.totalCents);
    expect(ws.lines.every((l: { basis: string }) => l.basis.length > 5)).toBe(true);
  });

  it('loads a bigger crowd and alcohol, and the proposed price follows', async () => {
    const { quote, referralId } = await referred({ participants: 400, alcohol: 'sold' });
    const ws = (await worksheet(referralId)).json();
    const base = quote.premium.netCents;
    const byId = Object.fromEntries(
      ws.lines.map((l: { id: string; amountCents: number }) => [l.id, l.amountCents]),
    );
    expect(byId.attendance).toBe(Math.round((base * 1000) / 10_000));
    expect(byId.alcohol).toBe(Math.round((base * 1500) / 10_000));
    expect(ws.netTotalCents).toBe(base + byId.attendance + byId.alcohol);
    expect(ws.proposed.netCents).toBe(ws.netTotalCents);
    expect(ws.proposed.totalCents).toBeGreaterThan(quote.premium.totalCents);
  });

  it('shows what the description says is hazardous and what the application left out', async () => {
    t.llm.handler = () => ({
      activities: ['hockey game'],
      participants: 50,
      hours: 2,
      alcohol: 'none',
      flags: ['minors'],
    });
    const classified = (
      await t.app.inject({
        method: 'POST',
        url: '/v1/intake/classify',
        headers: { authorization: `Bearer ${creator}` },
        payload: { text: 'Youth hockey game for 50 kids, 2 hours, no alcohol' },
      })
    ).json();
    const { referralId } = await referred({ classificationId: classified.id });
    const ids = (await worksheet(referralId)).json().lines.map((l: { id: string }) => l.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'base',
        'attendance',
        'alcohol',
        'flag:minors',
        'vendors',
        'seats',
        'claims',
      ]),
    );
  });

  it('lists the decided referrals closest in activity and size as comparables', async () => {
    for (const participants of [30, 60, 200]) {
      const { referralId } = await referred({ participants });
      expect((await approve(referralId)).statusCode).toBe(200);
    }
    const rugby = await t.activityId('Rugby'); // same product, another activity: further away than the right activity
    const other = await referred({ activityId: rugby, participants: 50 });
    await approve(other.referralId);
    const open = await referred({ participants: 50 }); // not decided: must not show up
    const { referralId } = await referred({ participants: 50 });
    const comparables = (await worksheet(referralId)).json().comparables;
    expect(comparables.slice(0, 3).map((c: { participants: number }) => c.participants)).toEqual([
      60, 30, 200,
    ]);
    expect(comparables[0]).toMatchObject({ activityTitle: 'Ice hockey game', action: 'approve' });
    expect(comparables[0].totalCents).toBeGreaterThan(0);
    expect(comparables.map((c: { quoteId: string }) => c.quoteId)).not.toContain(open.quote.id);
    expect(comparables.length).toBeLessThanOrEqual(5);
  });

  it('needs a price and the right program', async () => {
    const fireworks = await t.activityId('Fireworks display');
    const noPrice = await referred({ activityId: fireworks });
    const res = await worksheet(noPrice.referralId);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('no_price');
    const { referralId } = await referred();
    expect((await worksheet(referralId, uwProgram2)).statusCode).toBe(404);
  });
});

describe('deciding with the worksheet', () => {
  it('prices at the edited total and keeps both amounts and the note', async () => {
    const { quote, referralId } = await referred({ participants: 400, alcohol: 'sold' });
    const proposed = (await worksheet(referralId)).json();
    const alcohol = proposed.lines.find((l: { id: string }) => l.id === 'alcohol');
    const res = await approve(referralId, {
      action: 'approve',
      note: 'standard league night',
      lines: [{ id: 'alcohol', amountCents: 500, note: 'the bar closes at nine' }],
    });
    expect(res.statusCode).toBe(200);
    const after = (await send('GET', `/v1/quotes/${quote.id}`, creator)).json();
    expect(after.state).toBe('quoted');
    expect(after.premium.netCents).toBe(proposed.netTotalCents - alcohol.amountCents + 500);
    expect(after.premium.rateRowId).toBe(quote.premium.rateRowId);
    const sum =
      after.premium.netCents +
      after.premium.commissionCents +
      after.premium.marginCents +
      after.premium.feeCents +
      after.premium.taxCents;
    expect(sum).toBe(after.premium.totalCents);

    const stored = await t.db
      .selectFrom('referral')
      .select('decision')
      .where('id', '=', referralId)
      .executeTakeFirstOrThrow();
    const lines = (
      stored.decision as {
        worksheet: { id: string; amountCents: number; editedFromCents?: number; note?: string }[];
      }
    ).worksheet;
    expect(lines.find((l) => l.id === 'alcohol')).toMatchObject({
      amountCents: 500,
      editedFromCents: alcohol.amountCents,
      note: 'the bar closes at nine',
    });
    expect(lines.find((l) => l.id === 'attendance')?.editedFromCents).toBeUndefined();
  });

  it('refuses edits that do not make sense', async () => {
    const { referralId } = await referred({ participants: 400, alcohol: 'sold' });
    await send('POST', `/v1/referrals/${referralId}/claim`, uw);
    const decide = (lines: object[], action = 'approve') =>
      send('POST', `/v1/referrals/${referralId}/decision`, uw, {
        action,
        note: 'x',
        ...(action === 'approve_with_override' ? { riskClass: 'B' } : {}),
        lines,
      });
    for (const lines of [
      [{ id: 'nope', amountCents: 1, note: 'x' }],
      [{ id: 'base', amountCents: 1, note: 'x' }],
      [{ id: 'alcohol', amountCents: -10_000_000, note: 'x' }],
      [{ id: 'alcohol', amountCents: 1.5, note: 'x' }],
      [{ id: 'alcohol', amountCents: 100 }],
    ]) {
      expect((await decide(lines)).statusCode, JSON.stringify(lines)).toBe(400);
    }
    expect(
      (await decide([{ id: 'alcohol', amountCents: 100, note: 'x' }], 'decline')).statusCode,
    ).toBe(400);
    expect(
      (await decide([{ id: 'alcohol', amountCents: 100, note: 'x' }], 'approve_with_override'))
        .statusCode,
    ).toBe(400);
    const still = await t.db
      .selectFrom('referral')
      .select('state')
      .where('id', '=', referralId)
      .executeTakeFirstOrThrow();
    expect(still.state).toBe('claimed'); // nothing was decided by the bad requests
  });
});
