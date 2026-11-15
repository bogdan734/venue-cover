import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../../db/types.js';
import { newId } from '../../domain/ids.js';
import type { ReferralReason } from '../../domain/types.js';

const DUE_AFTER_MS = 24 * 3600_000;

// Opens the human review for a quote that could not be priced automatically; the underwriter has 24 hours.
export async function openReferral(
  trx: Transaction<Database>,
  quoteId: string,
  reasons: ReferralReason[],
  now: Date,
): Promise<string> {
  const id = newId('ref');
  await trx
    .insertInto('referral')
    .values({
      id,
      quote_id: quoteId,
      reasons,
      due_at: new Date(now.getTime() + DUE_AFTER_MS),
      created_at: now,
    })
    .execute();
  return id;
}

export async function referralReasons(
  db: Kysely<Database>,
  quoteId: string,
): Promise<ReferralReason[]> {
  const row = await db
    .selectFrom('referral')
    .select('reasons')
    .where('quote_id', '=', quoteId)
    .executeTakeFirst();
  return (row?.reasons ?? []) as ReferralReason[];
}
