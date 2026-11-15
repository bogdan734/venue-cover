import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../test/app.js';
import { OPERATIONS } from './openapi.js';

let t: TestApp;
let key: string;
beforeAll(async () => {
  t = await createTestApp();
  key = await t.keyFor('prg_1', ['quotes:read']);
});
afterAll(() => t.close());

const toOpenApiPath = (url: string) => url.replace(/:(\w+)/g, '{$1}');

describe('GET /v1/openapi.json', () => {
  it('describes every /v1 route of the server and nothing that is not there', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: '/v1/openapi.json',
      headers: { authorization: `Bearer ${key}` },
    });
    expect(res.statusCode).toBe(200);
    const spec = res.json();
    expect(spec.openapi).toMatch(/^3\.1/);
    const documented = new Set(
      Object.entries(spec.paths as Record<string, Record<string, unknown>>).flatMap(([path, ops]) =>
        Object.keys(ops).map((m) => `${m.toUpperCase()} ${path}`),
      ),
    );
    const actual = new Set(t.app.apiRoutes.map((r) => `${r.method} ${toOpenApiPath(r.url)}`));
    expect(actual.size).toBeGreaterThan(25);
    expect([...actual].filter((r) => !documented.has(r))).toEqual([]);
    expect([...documented].filter((r) => !actual.has(r))).toEqual([]);
  });

  it('has a hand-written description for every route, so none is a placeholder', () => {
    const missing = t.app.apiRoutes
      .map((r) => `${r.method} ${r.url}`)
      .filter((r) => !OPERATIONS[r]);
    expect(missing).toEqual([]);
    const stale = Object.keys(OPERATIONS).filter(
      (k) => !t.app.apiRoutes.some((r) => `${r.method} ${r.url}` === k),
    );
    expect(stale).toEqual([]);
  });

  it('documents scopes, idempotency and the request schema of a write', async () => {
    const spec = (
      await t.app.inject({
        method: 'GET',
        url: '/v1/openapi.json',
        headers: { authorization: `Bearer ${key}` },
      })
    ).json();
    const create = spec.paths['/v1/quotes'].post;
    expect(create.security).toEqual([{ bearerAuth: [] }]);
    expect(create['x-required-scope']).toBe('quotes:write');
    expect(create.parameters.map((p: { name: string }) => p.name)).toContain('Idempotency-Key');
    const schema = create.requestBody.content['application/json'].schema;
    expect(schema.properties.activityId).toBeDefined();
    expect(schema.required).toEqual(
      expect.arrayContaining(['activityId', 'participants', 'hours']),
    );
    expect(
      spec.paths['/v1/quotes/{id}'].get.parameters.map((p: { name: string }) => p.name),
    ).toContain('id');
    expect(spec.components.securitySchemes.bearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
  });

  it('needs a key', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/v1/openapi.json' })).statusCode).toBe(401);
  });
});
