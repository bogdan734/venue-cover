import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../test/app.js';

let t: TestApp;
let creator: string; // program 1: reads and writes quotes
let reader: string; // program 1: reads only
let uw: string; // no program: underwriter
let other: string; // program 2
let hockey: string;
let counter = 0;

beforeAll(async () => {
  t = await createTestApp();
  creator = await t.keyFor('prg_1', ['quotes:read', 'quotes:write', 'personal:read']);
  reader = await t.keyFor('prg_1', ['quotes:read', 'personal:read']);
  uw = await t.keyFor(null, ['referrals:decide', 'quotes:read', 'personal:read']);
  other = await t.keyFor('prg_2', ['quotes:read', 'quotes:write']);
  hockey = await t.activityId('Ice hockey game');
});
afterAll(() => t.close());

interface GqlResult {
  // biome-ignore lint/suspicious/noExplicitAny: a test helper that reads whatever shape the query asked for
  data?: Record<string, any> | null;
  errors?: { message: string; extensions?: { code?: string; reason?: string } }[];
}
async function gql(
  query: string,
  key: string,
  variables: object = {},
  headers: Record<string, string> = {},
) {
  const res = await t.app.inject({
    method: 'POST',
    url: '/graphql',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...headers },
    payload: { query, variables },
  });
  return { status: res.statusCode, body: res.json() as GqlResult };
}
const idem = () => ({ 'idempotency-key': `g-${++counter}` });

const quoteInput = (over: Record<string, unknown> = {}) => ({
  activityId: hockey,
  participants: 40,
  hours: 2,
  alcohol: 'none',
  eventDate: '2026-12-20',
  startTime: '18:00',
  limitCents: 200_000_000,
  holderName: 'Pat Example',
  holderEmail: 'pat@example.org',
  ...over,
});
const CREATE = `mutation($input: QuoteInput!) { createQuote(input: $input) { id state premium { totalCents } referralReasons } }`;

// A referred, approved, bound quote: a decided referral whose quote has a policy.
async function boundReferral() {
  const created = await gql(CREATE, creator, { input: quoteInput() }, idem());
  const quote = created.body.data?.createQuote;
  const referral = await t.db
    .selectFrom('referral')
    .select('id')
    .where('quote_id', '=', quote.id)
    .executeTakeFirstOrThrow();
  await gql(`mutation($id: ID!) { claimReferral(id: $id) { state } }`, uw, { id: referral.id });
  await gql(
    `mutation($id: ID!, $d: DecisionInput!) { decideReferral(id: $id, decision: $d) { state } }`,
    uw,
    { id: referral.id, d: { action: 'approve', note: 'ok' } },
    idem(),
  );
  const bound = await t.app.inject({
    method: 'POST',
    url: `/v1/quotes/${quote.id}/bind`,
    headers: { authorization: `Bearer ${creator}`, 'idempotency-key': `bind-${++counter}` },
    payload: { paymentToken: 'tok_ok' },
  });
  expect(bound.statusCode).toBe(200);
  return quote.id as string;
}

const NESTED = `{ referrals(state: "decided") { id state quote { id state program { code name } activity { title productCode } policy { policyNumber program { code } } } } }`;

describe('reading', () => {
  it('resolves nested programs, activities and policies in a fixed number of queries, whatever the list size', async () => {
    for (let i = 0; i < 3; i++) await boundReferral();
    t.queries.length = 0;
    const small = await gql(NESTED, uw);
    const smallQueries = t.queries.length;
    expect(small.body.errors).toBeUndefined();
    const items = small.body.data?.referrals as {
      quote: {
        program: { code: string };
        activity: { title: string };
        policy: { policyNumber: string };
      };
    }[];
    expect(items.length).toBeGreaterThanOrEqual(3);
    for (const item of items) {
      expect(item.quote.program.code).toBe('FHV');
      expect(item.quote.activity.title).toBe('Ice hockey game');
      expect(item.quote.policy.policyNumber).toMatch(/^FHV-\d{6}$/);
    }

    for (let i = 0; i < 6; i++) await boundReferral();
    t.queries.length = 0;
    const large = await gql(NESTED, uw);
    expect(((large.body.data?.referrals ?? []) as unknown[]).length).toBeGreaterThanOrEqual(9);
    expect(t.queries.length).toBe(smallQueries);
    const count = (table: string) => t.queries.filter((q) => q.includes(`from "${table}"`)).length;
    expect(count('program')).toBe(2); // one batch for the quotes' programs, one for the policies' programs
    expect(count('policy')).toBe(1);
  });

  it('reads one quote with its policy and the program rules as JSON', async () => {
    const id = await boundReferral();
    const res = await gql(
      `query($id: ID!) { quote(id: $id) { id state holder { name } premium { totalCents } policy { policyNumber startsAt } program { rules } } }`,
      creator,
      { id },
    );
    expect(res.body.errors).toBeUndefined();
    const quote = res.body.data?.quote;
    expect(quote).toMatchObject({ id, state: 'bound', holder: { name: 'Pat Example' } });
    expect(quote.policy.policyNumber).toMatch(/^FHV-/);
    expect(quote.program.rules).toMatchObject({ autoMaxClass: 'B', alcoholAuto: true });
  });

  it('searches the catalogue and hides other programs', async () => {
    const found = await gql(`{ activities(q: "yoga") { title riskClass score } }`, creator);
    expect(found.body.data?.activities[0]).toMatchObject({ title: 'Yoga class', riskClass: 'A' });
    const own = await gql(`{ program(id: "prg_1") { code } }`, creator);
    expect(own.body.data?.program).toEqual({ code: 'FHV' });
    const foreign = await gql(`{ program(id: "prg_1") { code } }`, other);
    expect(foreign.body.data?.program).toBeNull();
    const missing = await gql(`{ quote(id: "qte_nope") { id } }`, creator);
    expect(missing.body.errors?.[0]?.extensions).toMatchObject({
      code: 'NOT_FOUND',
      reason: 'quote_not_found',
    });
  });
});

describe('limits', () => {
  const nest = (depth: number) => {
    // quote { referral { quote { referral { ... id } } } }, `depth` selections deep
    let inner = 'id';
    for (let level = depth - 1; level >= 1; level--)
      inner = level % 2 === 1 ? `quote { ${inner} }` : `referral { ${inner} }`;
    return `{ ${inner.replace(/^quote/, 'quote(id: "qte_x")')} }`;
  };

  it('rejects a query nested deeper than eight levels, and accepts eight', async () => {
    const tooDeep = await gql(nest(10), creator);
    expect(tooDeep.status).toBe(400);
    expect(JSON.stringify(tooDeep.body)).toMatch(/depth|deep/i);
    expect(tooDeep.body.data ?? null).toBeNull();
    const ok = await gql(nest(8), creator);
    expect(ok.body.errors?.some((e) => /depth/i.test(e.message))).toBeFalsy();
  });

  it('rejects a request without a valid key before executing it', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/graphql',
      headers: { 'content-type': 'application/json' },
      payload: { query: '{ activities(q: "yoga") { title } }' },
    });
    expect(res.statusCode).toBe(401);
    expect((await gql('{ activities(q: "yoga") { title } }', 'vck_nope')).status).toBe(401);
  });

  it('returns FORBIDDEN when the key lacks the scope', async () => {
    const write = await gql(CREATE, reader, { input: quoteInput() }, idem());
    expect(write.body.errors?.[0]?.extensions).toMatchObject({
      code: 'FORBIDDEN',
      reason: 'forbidden',
    });
    const queue = await gql(`{ referrals { id } }`, creator);
    expect(queue.body.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    const bind = await gql(
      `mutation { bindQuote(id: "x", paymentToken: "t") { policyId } }`,
      reader,
      {},
      idem(),
    );
    expect(bind.body.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
  });
});

describe('mutations', () => {
  it('creates a quote like the REST API and validates the same way', async () => {
    const ok = await gql(
      CREATE,
      creator,
      { input: quoteInput({ activityId: await t.activityId('Yoga class') }) },
      idem(),
    );
    expect(ok.body.errors).toBeUndefined();
    expect(ok.body.data?.createQuote).toMatchObject({ state: 'quoted', referralReasons: [] });
    const past = await gql(
      CREATE,
      creator,
      { input: quoteInput({ eventDate: '2026-11-01' }) },
      idem(),
    );
    expect(past.body.errors?.[0]?.extensions).toMatchObject({
      code: 'BAD_USER_INPUT',
      reason: 'event_in_the_past',
    });
    const bad = await gql(
      CREATE,
      creator,
      { input: quoteInput({ limitCents: 123, participants: 0 }) },
      idem(),
    );
    expect(bad.body.errors?.[0]?.extensions).toMatchObject({
      code: 'BAD_USER_INPUT',
      reason: 'validation_error',
    });
  });

  it('needs an Idempotency-Key and replays the same answer for the same one', async () => {
    const none = await gql(CREATE, creator, { input: quoteInput() });
    expect(none.body.errors?.[0]?.extensions).toMatchObject({
      code: 'BAD_USER_INPUT',
      reason: 'idempotency_key_required',
    });
    const headers = { 'idempotency-key': 'same-create' };
    const a = await gql(CREATE, creator, { input: quoteInput() }, headers);
    const b = await gql(CREATE, creator, { input: quoteInput() }, headers);
    expect(b.body.data?.createQuote.id).toBe(a.body.data?.createQuote.id);
    const changed = await gql(
      CREATE,
      creator,
      { input: quoteInput({ participants: 41 }) },
      headers,
    );
    expect(changed.body.errors?.[0]?.extensions?.code).toBe('CONFLICT');
  });

  it('binds once for the same key and charges once', async () => {
    const yoga = await t.activityId('Yoga class');
    const created = await gql(CREATE, creator, { input: quoteInput({ activityId: yoga }) }, idem());
    const id = created.body.data?.createQuote.id;
    const before = t.payments.calls.length;
    const BIND = `mutation($id: ID!) { bindQuote(id: $id, paymentToken: "tok_ok") { policyId policyNumber } }`;
    const headers = { 'idempotency-key': 'same-bind' };
    const first = await gql(BIND, creator, { id }, headers);
    const second = await gql(BIND, creator, { id }, headers);
    expect(first.body.errors).toBeUndefined();
    expect(second.body.data?.bindQuote).toEqual(first.body.data?.bindQuote);
    expect(t.payments.calls.length).toBe(before + 1);
    expect(
      await t.db.selectFrom('policy').select('id').where('quote_id', '=', id).execute(),
    ).toHaveLength(1);
    const noKey = await gql(BIND, creator, { id });
    expect(noKey.body.errors?.[0]?.extensions?.reason).toBe('idempotency_key_required');
  });

  it('keeps the keys of two mutations in one request apart', async () => {
    const res = await gql(
      `mutation($a: QuoteInput!, $b: QuoteInput!) { first: createQuote(input: $a) { id } second: createQuote(input: $b) { id } }`,
      creator,
      { a: quoteInput(), b: quoteInput({ participants: 50 }) },
      idem(),
    );
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data?.first.id).not.toBe(res.body.data?.second.id);
  });

  it('classifies a description and shows the decision', async () => {
    t.llm.handler = () => ({
      activities: ['yoga class'],
      participants: 20,
      hours: 2,
      alcohol: 'none',
      flags: [],
    });
    const res = await gql(
      `mutation { classifyEvent(text: "Yoga class for 20 people, 2 hours, no alcohol") { id riskClass primary { title } decision { outcome reasons } } }`,
      creator,
    );
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data?.classifyEvent).toMatchObject({
      riskClass: 'A',
      primary: { title: 'Yoga class' },
      decision: { outcome: 'auto', reasons: [] },
    });
  });

  it('lets an underwriter claim and decide a referral', async () => {
    const created = await gql(CREATE, creator, { input: quoteInput() }, idem());
    const quoteId = created.body.data?.createQuote.id;
    const referral = await t.db
      .selectFrom('referral')
      .select('id')
      .where('quote_id', '=', quoteId)
      .executeTakeFirstOrThrow();
    const claimed = await gql(`mutation($id: ID!) { claimReferral(id: $id) { state } }`, uw, {
      id: referral.id,
    });
    expect(claimed.body.data?.claimReferral.state).toBe('claimed');
    const DECIDE = `mutation($id: ID!, $d: DecisionInput!) { decideReferral(id: $id, decision: $d) { state quote { state } } }`;
    const decided = await gql(
      DECIDE,
      uw,
      {
        id: referral.id,
        d: { action: 'approve_with_override', riskClass: 'B', note: 'recreational' },
      },
      idem(),
    );
    expect(decided.body.errors).toBeUndefined();
    expect(decided.body.data?.decideReferral).toMatchObject({
      state: 'decided',
      quote: { state: 'quoted' },
    });
    const again = await gql(
      DECIDE,
      uw,
      { id: referral.id, d: { action: 'decline', note: 'x' } },
      idem(),
    );
    expect(again.body.errors?.[0]?.extensions).toMatchObject({
      code: 'CONFLICT',
      reason: 'already_decided',
    });
  });
});
