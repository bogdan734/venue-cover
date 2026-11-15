import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../../db/types.js';
import { type DomainEvent, toDomainEvent } from './outbox.js';

// A handler runs inside the transaction that marks the event processed, so its database writes
// happen exactly once; anything it does outside the database is at-least-once and must be idempotent.
export type EventHandler = (event: DomainEvent, trx: Transaction<Database>) => Promise<void>;

// After this many failed attempts an event is parked (left unprocessed, visible to operators) so it cannot block the queue.
export const MAX_ATTEMPTS = 5;

async function processNext(
  db: Kysely<Database>,
  handlers: readonly EventHandler[],
): Promise<boolean> {
  let seq: number | undefined;
  try {
    return await db.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom('outbox_event')
        .selectAll()
        .where('processed_at', 'is', null)
        .where('attempts', '<', MAX_ATTEMPTS)
        .orderBy('seq')
        .limit(1)
        .forUpdate()
        .skipLocked()
        .executeTakeFirst();
      if (!row) return false;
      seq = row.seq;
      const event = toDomainEvent(row);
      for (const handler of handlers) await handler(event, trx);
      await trx
        .updateTable('outbox_event')
        .set({ processed_at: new Date() })
        .where('seq', '=', row.seq)
        .execute();
      return true;
    });
  } catch (error) {
    if (seq !== undefined) {
      const message = error instanceof Error ? error.message : String(error);
      await db
        .updateTable('outbox_event')
        .set((eb) => ({ attempts: eb('attempts', '+', 1), last_error: message }))
        .where('seq', '=', seq)
        .execute();
    }
    throw error;
  }
}

// One transaction per event. Concurrent relays take different rows (SKIP LOCKED). Order follows the sequence
// number, but a transaction that commits late can surface an older number later, so consumers must not rely on order.
export async function drainOutbox(
  db: Kysely<Database>,
  handlers: readonly EventHandler[],
  batch: number,
): Promise<number> {
  let processed = 0;
  while (processed < batch && (await processNext(db, handlers))) processed++;
  return processed;
}

export function startRelay(
  db: Kysely<Database>,
  handlers: readonly EventHandler[],
  options: { intervalMs: number; batch: number; onError: (error: unknown) => void },
): { stop(): Promise<void> } {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void>;

  const tick = async () => {
    try {
      while (!stopped && (await drainOutbox(db, handlers, options.batch)) === options.batch);
    } catch (error) {
      options.onError(error);
    }
    if (!stopped) {
      timer = setTimeout(() => {
        running = tick();
      }, options.intervalMs);
    }
  };
  running = tick();

  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await running;
    },
  };
}
