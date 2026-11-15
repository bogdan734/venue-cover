import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../../../test/db.js';
import { SimulatedMail } from '../../providers/mail.js';
import { SimulatedPayments } from '../../providers/payments.js';
import { buildServer } from '../../server.js';
import { createLexicalEmbedder } from '../catalogue/index.js';
import { createFakeLlm } from '../intake/index.js';
import { createShield } from '../privacy/index.js';
import { createApiKey, idempotent, requireAuth, withIdempotency } from './index.js';

let t: TestDb;
let app: FastifyInstance;
let runs = 0;

beforeAll(async () => {
  t = await createTestDb();
  app = buildServer({
    db: t.db,
    payments: new SimulatedPayments(),
    mail: new SimulatedMail(),
    llm: createFakeLlm(() => ({})),
    embedder: createLexicalEmbedder(),
    shield: createShield({ secret: 'a test secret that is long enough' }),
    clock: () => new Date(),
  });
  app.get('/test/needs-write', { preHandler: requireAuth(t.db, 'quotes:write') }, async () => ({
    ok: true,
  }));
  app.post('/test/charge', { preHandler: requireAuth(t.db, 'quotes:write') }, async (request) =>
    idempotent(t.db, request, async () => ({ charge: ++runs })),
  );
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await t.drop();
});

const bearer = (key: string) => ({ authorization: `Bearer ${key}` });

describe('authentication', () => {
  it('rejects a missing, malformed or unknown key with 401', async () => {
    for (const headers of [{}, { authorization: 'Token abc' }, bearer('vck_unknown')]) {
      const res = await app.inject({ method: 'GET', url: '/v1/me', headers });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: { code: 'unauthorized', message: expect.any(String) } });
    }
  });

  it('accepts a valid key and reports who it is', async () => {
    const { id, key } = await createApiKey(t.db, {
      name: 'tester',
      programId: null,
      scopes: ['quotes:read'],
    });
    const res = await app.inject({ method: 'GET', url: '/v1/me', headers: bearer(key) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ keyId: id, programId: null, scopes: ['quotes:read'] });
  });

  it('rejects a revoked key', async () => {
    const { id, key } = await createApiKey(t.db, {
      name: 'old',
      programId: null,
      scopes: ['quotes:read'],
    });
    await t.db
      .updateTable('api_key')
      .set({ revoked_at: new Date() })
      .where('id', '=', id)
      .execute();
    const res = await app.inject({ method: 'GET', url: '/v1/me', headers: bearer(key) });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a missing scope with 403', async () => {
    const { key } = await createApiKey(t.db, {
      name: 'reader',
      programId: null,
      scopes: ['quotes:read'],
    });
    const res = await app.inject({ method: 'GET', url: '/test/needs-write', headers: bearer(key) });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('forbidden');
  });

  it('stores only a hash of the key', async () => {
    const { id, key } = await createApiKey(t.db, { name: 'hashed', programId: null, scopes: [] });
    const row = await t.db
      .selectFrom('api_key')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row.key_hash).toBe(createHash('sha256').update(key).digest('hex'));
    expect(JSON.stringify(row)).not.toContain(key);
  });
});

describe('minting a key for a program', () => {
  const mint = (key: string, body: object) =>
    app.inject({ method: 'POST', url: '/v1/api-keys', headers: bearer(key), payload: body });
  const program = async (id: string) => {
    await t.db
      .insertInto('broker')
      .values({ id: `brk_${id}`, name: `Broker ${id}`, email: `${id}@example.org` })
      .execute();
    await t.db
      .insertInto('program')
      .values({
        id,
        code: id.toUpperCase().slice(-3),
        name: `Program ${id}`,
        province: 'ON',
        broker_id: `brk_${id}`,
        loading_bps: 4000,
        commission_bps: 1000,
        fee_cents: 100,
      })
      .execute();
    return id;
  };

  it('lets an operator mint a program key, shows the secret once and stores only its hash', async () => {
    const programId = await program('prg_ka');
    const operator = await createApiKey(t.db, {
      name: 'operator',
      programId: null,
      scopes: ['programs:manage', 'quotes:read', 'quotes:write'],
    });
    const res = await mint(operator.key, {
      programId,
      name: 'portal',
      scopes: ['quotes:read', 'quotes:write'],
    });
    expect(res.statusCode).toBe(201);
    const { id, key } = res.json();
    expect(key).toMatch(/^vck_/);
    const me = (await app.inject({ method: 'GET', url: '/v1/me', headers: bearer(key) })).json();
    expect(me).toEqual({ keyId: id, programId, scopes: ['quotes:read', 'quotes:write'] });
    const stored = await t.db
      .selectFrom('api_key')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(JSON.stringify(stored)).not.toContain(key);
    expect(stored.name).toBe('portal');
  });

  it('does not let a key grant a scope it does not hold', async () => {
    const programId = await program('prg_kb');
    const operator = await createApiKey(t.db, {
      name: 'operator',
      programId: null,
      scopes: ['programs:manage', 'quotes:read'],
    });
    const res = await mint(operator.key, {
      programId,
      name: 'x',
      scopes: ['quotes:read', 'referrals:decide'],
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toContain('referrals:decide');
  });

  it('is for operators: a program key, or a key without the programs scope, cannot mint', async () => {
    const programId = await program('prg_kc');
    const programKey = await createApiKey(t.db, {
      name: 'p',
      programId,
      scopes: ['programs:manage', 'quotes:read'],
    });
    const noScope = await createApiKey(t.db, {
      name: 'n',
      programId: null,
      scopes: ['quotes:read'],
    });
    const body = { programId, name: 'x', scopes: ['quotes:read'] };
    expect((await mint(programKey.key, body)).statusCode).toBe(403);
    expect((await mint(noScope.key, body)).statusCode).toBe(403);
  });

  it('refuses an unknown program, an unknown scope and an empty list', async () => {
    const programId = await program('prg_kd');
    const operator = await createApiKey(t.db, {
      name: 'operator',
      programId: null,
      scopes: ['programs:manage', 'quotes:read'],
    });
    expect(
      (await mint(operator.key, { programId: 'prg_nope', name: 'x', scopes: ['quotes:read'] }))
        .statusCode,
    ).toBe(404);
    expect(
      (await mint(operator.key, { programId, name: 'x', scopes: ['made:up'] })).statusCode,
    ).toBe(400);
    expect((await mint(operator.key, { programId, name: 'x', scopes: [] })).statusCode).toBe(400);
    expect(
      (await mint(operator.key, { programId, name: '', scopes: ['quotes:read'] })).statusCode,
    ).toBe(400);
  });
});

describe('idempotency', () => {
  const post = (key: string, headers: Record<string, string>, body: object, idem?: string) =>
    app.inject({
      method: 'POST',
      url: '/test/charge',
      headers: { ...bearer(key), ...headers, ...(idem ? { 'idempotency-key': idem } : {}) },
      payload: body,
    });

  it('requires an Idempotency-Key header', async () => {
    const { key } = await createApiKey(t.db, {
      name: 'w',
      programId: null,
      scopes: ['quotes:write'],
    });
    const res = await post(key, {}, { a: 1 });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('idempotency_key_required');
  });

  it('same key and body returns the stored response without running again', async () => {
    const { key } = await createApiKey(t.db, {
      name: 'w2',
      programId: null,
      scopes: ['quotes:write'],
    });
    const before = runs;
    const first = await post(key, {}, { a: 1, b: { c: 2 } }, 'k-1');
    const second = await post(key, {}, { b: { c: 2 }, a: 1 }, 'k-1');
    expect(first.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect(runs).toBe(before + 1);
  });

  it('same key with a different body returns 409', async () => {
    const { key } = await createApiKey(t.db, {
      name: 'w3',
      programId: null,
      scopes: ['quotes:write'],
    });
    await post(key, {}, { a: 1 }, 'k-2');
    const res = await post(key, {}, { a: 2 }, 'k-2');
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('idempotency_key_reused');
  });

  it('keeps keys apart per API key', async () => {
    const a = await createApiKey(t.db, { name: 'pa', programId: null, scopes: ['quotes:write'] });
    const b = await createApiKey(t.db, { name: 'pb', programId: null, scopes: ['quotes:write'] });
    const before = runs;
    await post(a.key, {}, { x: 1 }, 'shared');
    await post(b.key, {}, { x: 1 }, 'shared');
    expect(runs).toBe(before + 2);
  });

  it('runs once when two requests with one key arrive together', async () => {
    let executions = 0;
    const call = () =>
      withIdempotency(t.db, 'principal-x', 'k-3', 'hash-1', async () => {
        executions++;
        await new Promise((resolve) => setTimeout(resolve, 60));
        return { n: executions };
      });
    const [a, b] = await Promise.all([call(), call()]);
    expect(executions).toBe(1);
    expect(a).toEqual(b);
  });

  it('does not store a failed run, so a retry executes again', async () => {
    let attempts = 0;
    const call = () =>
      withIdempotency(t.db, 'principal-y', 'k-4', 'hash-2', async () => {
        attempts++;
        if (attempts === 1) throw new Error('boom');
        return { ok: true };
      });
    await expect(call()).rejects.toThrow('boom');
    expect(await call()).toEqual({ ok: true });
    expect(attempts).toBe(2);
  });
});

describe('error shape', () => {
  it('answers an unknown route in the standard error format', async () => {
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'not_found', message: expect.any(String) } });
  });
});
