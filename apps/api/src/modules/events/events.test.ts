import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../../../test/db.js';
import { appendEvent, type DomainEvent, drainOutbox, MAX_ATTEMPTS, startRelay } from './index.js';

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.drop();
});

const append = (type: 'quote.created' | 'policy.issued' = 'quote.created', data: unknown = {}) =>
  t.db.transaction().execute((trx) => appendEvent(trx, { type, programId: 'prg_1', data }));

// Each test drains what earlier tests left behind, so counts stay exact.
async function clear() {
  await t.db.deleteFrom('outbox_event').execute();
}

describe('outbox', () => {
  it('keeps an event invisible until its transaction commits', async () => {
    await clear();
    const seen: string[] = [];
    const handler = async (e: DomainEvent) => void seen.push(e.id);
    let appended: DomainEvent | undefined;
    await t.db.transaction().execute(async (trx) => {
      appended = await appendEvent(trx, {
        type: 'quote.created',
        programId: 'prg_1',
        data: { a: 1 },
      });
      expect(await drainOutbox(t.db, [handler], 10)).toBe(0);
    });
    expect(await drainOutbox(t.db, [handler], 10)).toBe(1);
    expect(seen).toEqual([appended?.id]);
  });

  it('drops the event when its transaction rolls back', async () => {
    await clear();
    await expect(
      t.db.transaction().execute(async (trx) => {
        await appendEvent(trx, { type: 'quote.created', programId: 'prg_1', data: {} });
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect(await drainOutbox(t.db, [async () => {}], 10)).toBe(0);
  });

  it('delivers events in order to a single relay and marks them processed', async () => {
    await clear();
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push((await append('quote.created', { i })).id);
    const seen: string[] = [];
    expect(await drainOutbox(t.db, [async (e) => void seen.push(e.id)], 3)).toBe(3);
    expect(await drainOutbox(t.db, [async (e) => void seen.push(e.id)], 3)).toBe(2);
    expect(seen).toEqual(ids);
    expect(await drainOutbox(t.db, [async () => {}], 3)).toBe(0);
  });

  it('lets two concurrent relays deliver each event once', async () => {
    await clear();
    for (let i = 0; i < 20; i++) await append('quote.created', { i });
    const seen: string[] = [];
    const slow = async (e: DomainEvent) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      seen.push(e.id);
    };
    const [a, b] = await Promise.all([
      drainOutbox(t.db, [slow], 20),
      drainOutbox(t.db, [slow], 20),
    ]);
    expect(a + b).toBe(20);
    expect(new Set(seen).size).toBe(20);
  });

  it('leaves the event pending and counts the attempt when a handler fails', async () => {
    await clear();
    await append();
    await expect(
      drainOutbox(
        t.db,
        [
          async () => {
            throw new Error('handler down');
          },
        ],
        10,
      ),
    ).rejects.toThrow('handler down');
    const row = await t.db.selectFrom('outbox_event').selectAll().executeTakeFirstOrThrow();
    expect(row.processed_at).toBeNull();
    expect(row.attempts).toBe(1);
    expect(row.last_error).toBe('handler down');
  });

  it('rolls back the writes of earlier handlers when a later one fails', async () => {
    await clear();
    await append();
    const writes = async (_e: DomainEvent, trx: typeof t.db) => {
      await trx
        .insertInto('sanctions_entry')
        .values({ id: 'sanc_t', name: 'Temp Co', list_name: 'x' })
        .execute();
    };
    const fails = async () => {
      throw new Error('second handler down');
    };
    await expect(drainOutbox(t.db, [writes, fails], 10)).rejects.toThrow('second handler down');
    const rows = await t.db.selectFrom('sanctions_entry').selectAll().execute();
    expect(rows).toEqual([]);
  });

  it('parks a poison event after the maximum attempts so later events still flow', async () => {
    await clear();
    const poison = await append('quote.created', { poison: true });
    const good = await append('policy.issued', { good: true });
    const seen: string[] = [];
    const handler = async (e: DomainEvent) => {
      if ((e.data as { poison?: boolean }).poison) throw new Error('bad event');
      seen.push(e.id);
    };
    for (let i = 0; i < MAX_ATTEMPTS; i++)
      await expect(drainOutbox(t.db, [handler], 10)).rejects.toThrow('bad event');
    expect(await drainOutbox(t.db, [handler], 10)).toBe(1);
    expect(seen).toEqual([good.id]);
    const parked = await t.db
      .selectFrom('outbox_event')
      .select(['processed_at', 'attempts'])
      .where('event_id', '=', poison.id)
      .executeTakeFirstOrThrow();
    expect(parked.processed_at).toBeNull();
    expect(parked.attempts).toBe(MAX_ATTEMPTS);
  });
});

describe('relay', () => {
  it('delivers events appended after it started and stops cleanly', async () => {
    await clear();
    const seen: string[] = [];
    const errors: unknown[] = [];
    const relay = startRelay(t.db, [async (e) => void seen.push(e.id)], {
      intervalMs: 10,
      batch: 10,
      onError: (e) => errors.push(e),
    });
    const a = await append();
    const b = await append('policy.issued');
    const deadline = Date.now() + 2000;
    while (seen.length < 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
    await relay.stop();
    expect(seen).toEqual([a.id, b.id]);
    expect(errors).toEqual([]);
  });

  it('reports a failing handler and keeps running', async () => {
    await clear();
    const errors: unknown[] = [];
    let calls = 0;
    const relay = startRelay(
      t.db,
      [
        async () => {
          if (++calls === 1) throw new Error('once');
        },
      ],
      { intervalMs: 10, batch: 10, onError: (e) => errors.push(e) },
    );
    await append();
    const deadline = Date.now() + 2000;
    while (calls < 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
    await relay.stop();
    expect(errors).toHaveLength(1);
    expect(calls).toBe(2);
  });
});
