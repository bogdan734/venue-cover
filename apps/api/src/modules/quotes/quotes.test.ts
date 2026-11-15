import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generate } from '../../../../../data/generate.js';
import { createTestApp, NOW, type TestApp } from '../../../test/app.js';

let t: TestApp;
let writeKey: string;
let otherProgramKey: string;
let birthday: string;
let fireworks: string;

beforeAll(async () => {
  t = await createTestApp();
  writeKey = await t.keyFor('prg_1', ['quotes:read', 'quotes:write']);
  otherProgramKey = await t.keyFor('prg_2', ['quotes:read', 'quotes:write']);
  birthday = await t.activityId('Birthday party');
  fireworks = await t.activityId('Fireworks display');
});
afterAll(() => t.close());

let counter = 0;
const body = (over: Record<string, unknown> = {}) => ({
  activityId: birthday,
  participants: 40,
  hours: 4,
  alcohol: 'none',
  eventDate: '2026-12-20',
  startTime: '18:00',
  limitCents: 200_000_000,
  holder: { name: 'Pat Example', email: 'pat@example.org' },
  ...over,
});
const send = (method: 'GET' | 'POST', url: string, key: string, payload?: object, idem?: string) =>
  t.app.inject({
    method,
    url,
    headers: {
      authorization: `Bearer ${key}`,
      ...(method === 'POST' ? { 'idempotency-key': idem ?? `k-${++counter}` } : {}),
    },
    ...(payload ? { payload } : {}),
  });
const create = (over: Record<string, unknown> = {}, key = writeKey) =>
  send('POST', '/v1/quotes', key, body(over));
const bind = (id: string, token = 'tok_ok', key = writeKey, idem?: string) =>
  send('POST', `/v1/quotes/${id}/bind`, key, { paymentToken: token }, idem);
const outboxTypes = async () =>
  (await t.db.selectFrom('outbox_event').select('type').orderBy('seq').execute()).map(
    (r) => r.type,
  );

describe('creating a quote', () => {
  it('prices a quote with the matching rate and the program terms', async () => {
    const res = await create();
    expect(res.statusCode).toBe(201);
    const quote = res.json();
    expect(quote).toMatchObject({
      programId: 'prg_1',
      state: 'quoted',
      activityId: birthday,
      referralReasons: [],
    });
    const row = await t.db
      .selectFrom('rate_row')
      .selectAll()
      .where('id', '=', quote.premium.rateRowId)
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({
      risk_class: 'A',
      alcohol: 'none',
      limit_cents: 200_000_000,
      effective_from: '2026-03-01',
    });
    expect(quote.premium.netCents).toBe(row.net_cents_per_hour * 4);
    const p = quote.premium;
    expect(p.netCents + p.commissionCents + p.marginCents + p.feeCents + p.taxCents).toBe(
      p.totalCents,
    );
    expect(p.feeCents).toBe(350);
    expect(p.taxCents).toBeGreaterThan(0);
    expect(new Date(quote.expiresAt).getTime()).toBeGreaterThan(NOW.getTime());
  });

  it('appends quote.created in the same transaction', async () => {
    const before = (await outboxTypes()).filter((x) => x === 'quote.created').length;
    await create();
    const after = (await outboxTypes()).filter((x) => x === 'quote.created').length;
    expect(after).toBe(before + 1);
  });

  it('replays the same response for the same Idempotency-Key', async () => {
    const first = await send('POST', '/v1/quotes', writeKey, body(), 'same-quote');
    const second = await send('POST', '/v1/quotes', writeKey, body(), 'same-quote');
    expect(second.json()).toEqual(first.json());
    const rows = await t.db
      .selectFrom('quote')
      .select('id')
      .where('id', '=', first.json().id)
      .execute();
    expect(rows).toHaveLength(1);
  });

  it('rejects a key that is not bound to a program', async () => {
    const global = await t.keyFor(null, ['quotes:write']);
    expect((await create({}, global)).statusCode).toBe(403);
  });

  it('answers 404 for an unknown activity and 400 for an invalid body', async () => {
    expect((await create({ activityId: 'act_nope' })).statusCode).toBe(404);
    const bad = await create({ participants: 0, limitCents: 123 });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('validation_error');
  });

  it('refuses an event date in the past', async () => {
    const res = await create({ eventDate: '2026-11-12' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('event_in_the_past');
  });

  it('refers an excluded activity with an open referral and no price', async () => {
    const res = await create({ activityId: fireworks });
    expect(res.statusCode).toBe(201);
    const quote = res.json();
    expect(quote).toMatchObject({
      state: 'referred',
      premium: null,
      referralReasons: ['EXCLUDED_ACTIVITY'],
    });
    const referral = await t.db
      .selectFrom('referral')
      .selectAll()
      .where('quote_id', '=', quote.id)
      .executeTakeFirstOrThrow();
    expect(referral.state).toBe('open');
    expect(referral.due_at.getTime()).toBe(NOW.getTime() + 24 * 3600_000);
    expect(await outboxTypes()).toContain('quote.referred');
  });

  it('refers an event above the largest participant band', async () => {
    const quote = (await create({ participants: 600 })).json();
    expect(quote).toMatchObject({
      state: 'referred',
      referralReasons: ['MISSING_FACTS', 'OVER_CAPACITY', 'PROGRAM_RULE'], // 600 people also raise the security question
    });
    expect(quote.premium.totalCents).toBeGreaterThan(0); // priced at the largest band, to start the underwriter from
  });
});

describe('reading a quote', () => {
  it('returns it to its own program only', async () => {
    const id = (await create()).json().id;
    expect((await send('GET', `/v1/quotes/${id}`, writeKey)).json().id).toBe(id);
    expect((await send('GET', `/v1/quotes/${id}`, otherProgramKey)).statusCode).toBe(404);
  });
});

describe('the policy of a quote', () => {
  it('is not there until the quote is paid for, and then is the policy that was issued', async () => {
    const id = (await create()).json().id;
    const before = await send('GET', `/v1/quotes/${id}/policy`, writeKey);
    expect(before.statusCode).toBe(404);
    expect(before.json().error.code).toBe('policy_not_found');
    const bound = (await bind(id, 'tok_ok', writeKey, `policy-of-${id}`)).json();
    const after = await send('GET', `/v1/quotes/${id}/policy`, writeKey);
    expect(after.statusCode).toBe(200);
    expect(after.json()).toMatchObject({
      id: bound.policyId,
      policyNumber: bound.policyNumber,
      quoteId: id,
    });
    const other = await send('GET', `/v1/quotes/${id}/policy`, otherProgramKey);
    expect(other.statusCode).toBe(404);
    expect(other.json().error.code).toBe('quote_not_found');
  });
});

describe('binding a quote', () => {
  it('charges once, issues one policy and moves the quote to bound, even when the request repeats', async () => {
    const id = (await create()).json().id;
    const before = t.payments.calls.length;
    const first = await bind(id, 'tok_ok', writeKey, 'bind-1');
    const second = await bind(id, 'tok_ok', writeKey, 'bind-1');
    expect(first.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect(t.payments.calls.length).toBe(before + 1);
    expect(t.payments.calls.at(-1)).toMatchObject({ reference: id });
    expect(
      await t.db.selectFrom('policy').select('id').where('quote_id', '=', id).execute(),
    ).toHaveLength(1);
    expect((await send('GET', `/v1/quotes/${id}`, writeKey)).json().state).toBe('bound');
    expect(await outboxTypes()).toContain('policy.issued');
  });

  it('numbers policies sequentially per program', async () => {
    const a = (await bind((await create()).json().id)).json().policyNumber as string;
    const b = (await bind((await create()).json().id)).json().policyNumber as string;
    const [, an] = a.split('-');
    const [, bn] = b.split('-');
    expect(a).toMatch(/^FHV-\d{6}$/);
    expect(Number(bn)).toBe(Number(an) + 1);
  });

  it('answers 402 for a declined payment and leaves the quote open', async () => {
    const id = (await create()).json().id;
    const res = await bind(id, 'tok_declined');
    expect(res.statusCode).toBe(402);
    expect(res.json().error.code).toBe('payment_declined');
    expect((await send('GET', `/v1/quotes/${id}`, writeKey)).json().state).toBe('quoted');
    expect(
      await t.db.selectFrom('policy').select('id').where('quote_id', '=', id).execute(),
    ).toEqual([]);
  });

  it('does not let a referred quote bind or charge', async () => {
    const id = (await create({ activityId: fireworks })).json().id;
    const before = t.payments.calls.length;
    const res = await bind(id);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('illegal_transition');
    expect(t.payments.calls.length).toBe(before);
  });

  it('does not bind another program quote', async () => {
    const id = (await create()).json().id;
    expect((await bind(id, 'tok_ok', otherProgramKey)).statusCode).toBe(404);
  });

  it('marks a lapsed quote expired and refuses to bind it', async () => {
    const id = (await create()).json().id;
    t.now.value = new Date(NOW.getTime() + 31 * 24 * 3600_000);
    try {
      const res = await bind(id);
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('quote_expired');
      expect((await send('GET', `/v1/quotes/${id}`, writeKey)).json().state).toBe('expired');
    } finally {
      t.now.value = NOW;
    }
  });

  it('rolls back state, counter and event together when the policy insert fails', async () => {
    const id = (await create()).json().id;
    await t.db
      .insertInto('policy')
      .values({
        id: 'pol_blocker',
        quote_id: id,
        program_id: 'prg_1',
        policy_number: 'XXX-000001',
        starts_at: NOW,
        ends_at: NOW,
        total_cents: 1,
        snapshot: '{}',
      })
      .execute();
    const counterBefore = (
      await t.db
        .selectFrom('policy_counter')
        .selectAll()
        .where('program_id', '=', 'prg_1')
        .executeTakeFirst()
    )?.last_number;
    const issuedBefore = (await outboxTypes()).filter((x) => x === 'policy.issued').length;

    const res = await bind(id);
    expect(res.statusCode).toBe(500);
    expect((await send('GET', `/v1/quotes/${id}`, writeKey)).json().state).toBe('quoted');
    const counterAfter = (
      await t.db
        .selectFrom('policy_counter')
        .selectAll()
        .where('program_id', '=', 'prg_1')
        .executeTakeFirst()
    )?.last_number;
    expect(counterAfter).toBe(counterBefore);
    expect((await outboxTypes()).filter((x) => x === 'policy.issued').length).toBe(issuedBefore);
  });
});

describe('deciding at creation', () => {
  it('prices a high-risk event automatically where the program allows it', async () => {
    const wide = await t.keyFor('prg_3', ['quotes:read', 'quotes:write']);
    const hockey = await t.activityId('Ice hockey game');
    const res = await create({ activityId: hockey, participants: 40, hours: 2 }, wide);
    expect(res.json()).toMatchObject({ state: 'quoted', referralReasons: [] });
    expect(res.json().premium).not.toBeNull();
  });

  it('refers a high-risk event where the program does not, but keeps an indicative price', async () => {
    const hockey = await t.activityId('Ice hockey game');
    const quote = (await create({ activityId: hockey, participants: 40, hours: 2 })).json();
    expect(quote).toMatchObject({ state: 'referred', referralReasons: ['PROGRAM_RULE'] });
    expect(quote.premium.totalCents).toBeGreaterThan(0);
  });

  it('refers a holder whose name is close to a listed name', async () => {
    const listed = generate(42).sanctions[0]?.name ?? '';
    const quote = (await create({ holder: { name: listed, email: 'x@example.org' } })).json();
    expect(quote).toMatchObject({
      state: 'referred',
      referralReasons: ['SANCTIONS_POSSIBLE_MATCH'],
    });
  });

  it('uses the classification: a mixed event is referred and priced at its highest class', async () => {
    t.llm.handler = () => ({
      activities: ['birthday party', 'bouncy castle party'],
      participants: 40,
      hours: 4,
      alcohol: 'none',
      flags: ['inflatables'],
    });
    const classified = (
      await t.app.inject({
        method: 'POST',
        url: '/v1/intake/classify',
        headers: { authorization: `Bearer ${writeKey}` },
        payload: { text: 'Kids birthday party with a bouncy castle party for 40, 4 hours' },
      })
    ).json();
    const quote = (
      await create({
        classificationId: classified.id,
        answers: { inflatable_supervision: 'operator', waivers_minors: true },
      })
    ).json();
    expect(quote).toMatchObject({
      state: 'referred',
      classificationId: classified.id,
      referralReasons: ['CLASS_CONFLICT', 'PROGRAM_RULE'],
    });
    const row = await t.db
      .selectFrom('rate_row')
      .select('risk_class')
      .where('id', '=', quote.premium.rateRowId)
      .executeTakeFirstOrThrow();
    expect(row.risk_class).toBe('C');
  });

  it('rejects a classification that does not exist for this program', async () => {
    const res = await create({ classificationId: 'cls_nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('classification_not_found');
  });
});

describe('the program questions', () => {
  const sold = { alcohol: 'sold' };

  it('refers a quote whose answer the program flags', async () => {
    const quote = (await create({ ...sold, answers: { server_training: false } })).json();
    expect(quote).toMatchObject({ state: 'referred', referralReasons: ['PROGRAM_RULE'] });
    expect(quote.input.answers).toEqual({ server_training: false });
  });

  it('prices a quote whose answers are all harmless', async () => {
    const quote = (await create({ ...sold, answers: { server_training: true } })).json();
    expect(quote).toMatchObject({ state: 'quoted', referralReasons: [] });
  });

  it('counts a question that applies but was not answered as missing information', async () => {
    const quote = (await create(sold)).json();
    expect(quote).toMatchObject({ state: 'referred', referralReasons: ['MISSING_FACTS'] });
  });

  it('rejects answers that do not fit the questions', async () => {
    for (const answers of [{ nope: true }, { server_training: 'yes' }]) {
      const res = await create({ ...sold, answers });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('invalid_answers');
    }
  });
});
