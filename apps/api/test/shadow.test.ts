import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLexicalEmbedder } from '../src/modules/catalogue/index.js';
import { createFakeLlm, type LlmProvider } from '../src/modules/intake/index.js';
import { replay, verdictOf } from '../src/modules/shadow/index.js';
import { createTestApp, NOW, type TestApp } from './app.js';

let t: TestApp;
let creator: string;
let underwriter: string;
let hockey: string;
let counter = 0;

beforeAll(async () => {
  t = await createTestApp();
  creator = await t.keyFor('prg_1', ['quotes:read', 'quotes:write']);
  underwriter = await t.keyFor(null, ['referrals:decide']);
  hockey = await t.activityId('Ice hockey game');
});
afterAll(() => t.close());

const post = (url: string, key: string, payload?: object) =>
  t.app.inject({
    method: 'POST',
    url,
    headers: { authorization: `Bearer ${key}`, 'idempotency-key': `s-${++counter}` },
    ...(payload ? { payload } : {}),
  });

const READING = { participants: 40, hours: 2, alcohol: 'none', flags: [] };
const hockeyModel = (): LlmProvider =>
  createFakeLlm(() => ({ activities: ['hockey game'], ...READING }));
// A "new model" that reads every hockey description as a yoga class, which a program would automate.
const yogaModel = (): LlmProvider =>
  createFakeLlm(() => ({ activities: ['yoga class'], ...READING }));

// A quote made from a description, referred because hockey is class C, and then decided by an underwriter.
async function decidedReferral(text: string | null, decision: object) {
  let classificationId: string | undefined;
  if (text) {
    t.llm.handler = () => ({ activities: ['hockey game'], ...READING });
    classificationId = (await post('/v1/intake/classify', creator, { text })).json().id;
  }
  const quote = (
    await post('/v1/quotes', creator, {
      activityId: hockey,
      participants: 40,
      hours: 2,
      alcohol: 'none',
      eventDate: '2026-12-20',
      startTime: '18:00',
      limitCents: 200_000_000,
      holder: { name: `Pat ${counter}`, email: 'pat@example.org' },
      ...(classificationId ? { classificationId } : {}),
    })
  ).json();
  const referral = await t.db
    .selectFrom('referral')
    .select('id')
    .where('quote_id', '=', quote.id)
    .executeTakeFirstOrThrow();
  expect((await post(`/v1/referrals/${referral.id}/claim`, underwriter)).statusCode).toBe(200);
  expect(
    (await post(`/v1/referrals/${referral.id}/decision`, underwriter, decision)).statusCode,
  ).toBe(200);
  return { quoteId: quote.id as string, referralId: referral.id as string };
}

const SINCE = new Date('2026-11-01T00:00:00.000Z');
const run = (llm: LlmProvider, since = SINCE) =>
  replay({ db: t.db, llm, embedder: createLexicalEmbedder(), now: NOW }, since);

describe('verdictOf', () => {
  it.each([
    ['auto', 'approve', false, 'automation_agrees'],
    ['auto', 'decline', false, 'automation_unsafe'],
    ['auto', 'approve_with_override', false, 'automation_unsafe'],
    ['auto', 'approve', true, 'automation_unsafe'],
    ['refer', 'approve', false, 'rubber_stamp'],
    ['refer', 'decline', false, 'human_needed'],
    ['refer', 'approve_with_override', false, 'human_needed'],
    ['refer', 'approve', true, 'human_needed'],
  ] as const)('system %s, human %s (edited %s) is %s', (outcome, action, edited, verdict) => {
    expect(verdictOf(outcome, { action, edited })).toBe(verdict);
  });
});

describe('replay', () => {
  let approved: { quoteId: string; referralId: string };
  let declined: { quoteId: string; referralId: string }[];
  let plain: { quoteId: string; referralId: string };

  beforeAll(async () => {
    approved = await decidedReferral('Hockey game for 40 people, Alpha club', {
      action: 'approve',
      note: 'fine',
    });
    declined = [
      await decidedReferral('Hockey tournament for 40, Beta club', {
        action: 'decline',
        note: 'no ice insurance',
      }),
      await decidedReferral('Hockey final for 40, Gamma club', {
        action: 'decline',
        note: 'no ice insurance',
      }),
    ];
    plain = await decidedReferral(null, { action: 'approve', note: 'priced by hand' });
  });

  it('computes the agreement rate against the stored decisions', async () => {
    const same = await run(hockeyModel());
    expect(same).toMatchObject({ decided: 4, replayed: 3, skipped: 1 });
    expect(same.counts).toEqual({
      automation_agrees: 0,
      human_needed: 2,
      rubber_stamp: 1,
      automation_unsafe: 0,
    });
    expect(same.agreement).toMatchObject({ successes: 2, n: 3 });
    expect(same.automaticRate.value).toBe(0);

    const candidate = await run(yogaModel());
    expect(candidate.counts).toEqual({
      automation_agrees: 1,
      human_needed: 0,
      rubber_stamp: 0,
      automation_unsafe: 2,
    });
    expect(candidate.agreement).toMatchObject({ successes: 1, n: 3 });
    expect(candidate.automaticRate.value).toBe(1);
  });

  it('lists the disagreements with the case and both answers, the unsafe ones first', async () => {
    const same = await run(hockeyModel());
    expect(same.disagreements).toHaveLength(1);
    expect(same.disagreements[0]).toMatchObject({
      referralId: approved.referralId,
      quoteId: approved.quoteId,
      text: expect.stringContaining('Alpha club'),
      human: { action: 'approve', edited: false },
      system: { outcome: 'refer', reasons: ['PROGRAM_RULE'] },
      verdict: 'rubber_stamp',
    });

    const candidate = await run(yogaModel());
    expect(candidate.disagreements.map((d) => d.verdict)).toEqual([
      'automation_unsafe',
      'automation_unsafe',
    ]);
    expect(candidate.disagreements.map((d) => d.referralId).sort()).toEqual(
      declined.map((d) => d.referralId).sort(),
    );
    expect(candidate.disagreements[0]).toMatchObject({
      human: { action: 'decline' },
      system: { outcome: 'auto', reasons: [] },
    });
  });

  it('skips a quote that was not made from a description, and says how many', async () => {
    const report = await run(hockeyModel());
    expect(report.skipped).toBe(1);
    expect(JSON.stringify(report.disagreements)).not.toContain(plain.referralId);
  });

  it('replays only what was decided since the date, and reports nothing to measure when that is nothing', async () => {
    const report = await run(hockeyModel(), new Date(NOW.getTime() + 86_400_000));
    expect(report).toMatchObject({ decided: 0, replayed: 0, skipped: 0, disagreements: [] });
    expect(report.agreement.value).toBeNull();
  });

  it('writes nothing: no classification rows are left behind', async () => {
    const count = async () =>
      (await t.db.selectFrom('classification').select('id').execute()).length;
    const before = await count();
    await run(yogaModel());
    expect(await count()).toBe(before);
  });
});

describe('GET /v1/reports/shadow', () => {
  const get = (url: string, key: string) =>
    t.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${key}` } });

  it('reports on the referrals decided since a date, for a key without a program', async () => {
    const reader = await t.keyFor(null, ['reports:read']);
    t.llm.handler = () => ({ activities: ['hockey game'], ...READING });
    const res = await get('/v1/reports/shadow?since=2026-11-01', reader);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ decided: 4, replayed: 3, skipped: 1 });
    expect(body.agreement).toMatchObject({ successes: 2, n: 3 });
    expect(body.disagreements).toHaveLength(1);
  });

  it('refuses a key bound to a program, and a bad date', async () => {
    const bound = await t.keyFor('prg_1', ['reports:read']);
    expect((await get('/v1/reports/shadow', bound)).statusCode).toBe(403);
    const reader = await t.keyFor(null, ['reports:read']);
    expect((await get('/v1/reports/shadow?since=yesterday', reader)).statusCode).toBe(400);
  });
});
