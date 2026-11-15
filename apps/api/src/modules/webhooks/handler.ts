import { sql } from 'kysely';
import { newId } from '../../domain/ids.js';
import type { EventHandler } from '../events/index.js';

// Fans an event out to the program's active endpoints that subscribe to its type: one pending delivery each.
// Runs inside the relay's transaction and tolerates being repeated (one delivery per endpoint and event).
export function createWebhookHandler(clock: () => Date): EventHandler {
  return async (event, trx) => {
    if (event.type === 'webhook.delivery.failed') return; // never delivered, so a dead endpoint cannot feed itself
    const endpoints = await trx
      .selectFrom('webhook_endpoint')
      .select('id')
      .where('program_id', '=', event.programId)
      .where('active', '=', true)
      .where(sql<boolean>`${event.type} = any(events)`)
      .execute();
    if (endpoints.length === 0) return;
    await trx
      .insertInto('webhook_delivery')
      .values(
        endpoints.map((e) => ({
          id: newId('whd'),
          endpoint_id: e.id,
          event_id: event.id,
          next_attempt_at: clock(),
        })),
      )
      .onConflict((oc) => oc.columns(['endpoint_id', 'event_id']).doNothing())
      .execute();
  };
}
