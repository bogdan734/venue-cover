import type { Kysely } from 'kysely';
import type { Database } from '../../db/types.js';
import type { RateRow } from './rate.js';

// Rate rows of one product that apply on the given calendar date.
export async function loadRateRows(
  db: Kysely<Database>,
  productId: string,
  eventDate: string,
): Promise<RateRow[]> {
  const rows = await db
    .selectFrom('rate_row')
    .selectAll()
    .where('product_id', '=', productId)
    .where('effective_from', '<=', eventDate)
    .where((eb) => eb.or([eb('effective_to', 'is', null), eb('effective_to', '>', eventDate)]))
    .execute();
  return rows.map((r) => ({
    id: r.id,
    productId: r.product_id,
    riskClass: r.risk_class,
    limitCents: r.limit_cents,
    alcohol: r.alcohol,
    participantsMin: r.participants_min,
    participantsMax: r.participants_max,
    netCentsPerHour: r.net_cents_per_hour,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
  }));
}
