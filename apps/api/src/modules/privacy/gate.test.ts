import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/app.js';

let t: TestApp;
let agent: string; // program 1, quotes only: the key an AI agent is given
let person: string; // program 1, also allowed to read personal details
let counter = 0;

beforeAll(async () => {
  t = await createTestApp();
  agent = await t.keyFor('prg_1', ['quotes:read', 'quotes:write']);
  person = await t.keyFor('prg_1', ['quotes:read', 'quotes:write', 'personal:read']);
});
afterAll(() => t.close());

const TAG = /^\[(NAME|EMAIL)#[A-Z2-7]{6}\]$/;
const get = async (url: string, key: string) =>
  t.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${key}` } });
const read = async (url: string, key: string) => (await get(url, key)).json();

async function quoteFor(holder: { name: string; email: string }, key = agent) {
  return t.app.inject({
    method: 'POST',
    url: '/v1/quotes',
    headers: { authorization: `Bearer ${key}`, 'idempotency-key': `gate-${++counter}` },
    payload: {
      activityId: await t.activityId('Birthday party'),
      participants: 40,
      hours: 4,
      alcohol: 'none',
      eventDate: '2026-12-20',
      startTime: '18:00',
      limitCents: 200_000_000,
      holder,
    },
  });
}

describe('personal details in answers', () => {
  it('reach a key without personal:read as tags, the same each time, in REST and in GraphQL', async () => {
    const { quoteId, policyId } = await t.bindPolicy('prg_1');
    const quote = await read(`/v1/quotes/${quoteId}`, agent);
    expect(quote.holder.name).toMatch(TAG);
    expect(quote.holder.email).toMatch(TAG);
    expect((await read(`/v1/quotes/${quoteId}`, agent)).holder).toEqual(quote.holder);
    expect((await read(`/v1/quotes/${quoteId}`, person)).holder.email).toBe('pat@example.org');

    const policy = await read(`/v1/policies/${policyId}`, agent);
    expect(policy.snapshot.holder).toEqual(quote.holder);
    expect(JSON.stringify(policy)).not.toMatch(/pat@example\.org|"Pat \d/);

    const graphql = await t.app.inject({
      method: 'POST',
      url: '/graphql',
      headers: { authorization: `Bearer ${agent}` },
      payload: { query: `{ quote(id: "${quoteId}") { holder { name } } }` },
    });
    expect(graphql.json().data.quote.holder.name).toBe(quote.holder.name);
  });

  it('can be handed back as tags: the new quote gets the values they stand for', async () => {
    const { quoteId } = await t.bindPolicy('prg_1');
    const { holder } = await read(`/v1/quotes/${quoteId}`, agent);
    const created = await quoteFor(holder);
    expect(created.statusCode).toBe(201);
    expect(created.json().holder).toEqual(holder);
    const real = await read(`/v1/quotes/${created.json().id}`, person);
    expect(real.holder).toEqual((await read(`/v1/quotes/${quoteId}`, person)).holder);
  });

  it('refuses a tag the program never gave out', async () => {
    const refused = await quoteFor({ name: '[NAME#AAAAAA]', email: '[EMAIL#AAAAAA]' });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.code).toBe('unknown_tag');
  });

  it('keeps certificates, which name people, for keys allowed to read personal details', async () => {
    const { policyId } = await t.bindPolicy('prg_1');
    const url = `/v1/policies/${policyId}/certificates/insured`;
    expect((await get(url, agent)).statusCode).toBe(403);
    expect((await get(url, person)).statusCode).toBe(200);
  });
});
