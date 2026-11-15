import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../test/app.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

const get = (url: string, key: string) =>
  t.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${key}` } });

interface Entry {
  key: string;
  method: string;
  route: string;
  status: number;
  ms: number;
}

describe('the request log', () => {
  it('lists a program’s own requests by route, never by address', async () => {
    const mine = await t.keyFor('prg_1', ['quotes:read']);
    const theirs = await t.keyFor('prg_2', ['quotes:read']);
    expect((await get('/v1/quotes/qte_missing?note=pat@example.org', mine)).statusCode).toBe(404);
    await get('/v1/me', theirs);

    const read = async (key: string) =>
      (await get('/v1/request-log', key)).json().requests as Entry[];
    await expect
      .poll(async () => (await read(mine)).some((r) => r.route === '/v1/quotes/:id'))
      .toBe(true);
    const own = await read(mine);
    expect(own.find((r) => r.route === '/v1/quotes/:id')).toMatchObject({
      key: 'test',
      method: 'GET',
      status: 404,
    });
    expect(JSON.stringify(own)).not.toMatch(/pat@example\.org|qte_missing/);
    expect(own.some((r) => r.route === '/v1/me')).toBe(false); // the other program's

    const operator = await t.keyFor(null, ['reports:read']);
    await expect
      .poll(async () => (await read(operator)).some((r) => r.route === '/v1/me'))
      .toBe(true);
  });
});
