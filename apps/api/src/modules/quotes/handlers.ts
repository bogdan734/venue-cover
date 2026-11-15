import type { EventHandler } from '../events/index.js';
import { transition } from './machine.js';

// A quote becomes issued once the certificates for its policy are ready.
export const quoteEventHandler: EventHandler = async (event, trx) => {
  if (event.type !== 'certificate.ready') return;
  const { quoteId } = event.data as { quoteId: string };
  const row = await trx
    .selectFrom('quote')
    .select('state')
    .where('id', '=', quoteId)
    .forUpdate()
    .executeTakeFirst();
  if (row?.state !== 'bound') return; // already issued by an earlier delivery
  await trx
    .updateTable('quote')
    .set({ state: transition('bound', 'issue') })
    .where('id', '=', quoteId)
    .execute();
};
