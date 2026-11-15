import type { Kysely } from 'kysely';
import type { Database } from '../../db/types.js';
import type { PremiumBreakdown, RiskClass } from '../../domain/types.js';
import { type ActivityView, getActivities } from '../catalogue/index.js';
import type { QuoteRow, QuoteView } from './service.js';

export interface Comparable {
  quoteId: string;
  programId: string;
  activityTitle: string;
  riskClass: RiskClass;
  participants: number;
  hours: number;
  action: 'approve' | 'approve_with_override' | 'decline';
  /** The premium the case was decided at; null for a decline that never had one. */
  totalCents: number | null;
  decidedAt: string;
  distance: number;
}

const SCAN = 200;

// Past decisions on the same product, nearest first. Distance grows with a different activity and with the gap in
// crowd size and duration (on a log scale, so 30 against 60 is as far as 100 against 200). The latest few hundred
// decisions are scanned in memory; an index on a size column would replace that if the volume asked for it.
export async function comparablesFor(
  db: Kysely<Database>,
  quote: QuoteRow,
  activity: ActivityView,
  k: number,
): Promise<Comparable[]> {
  const mine = quote.input as QuoteView['input'];
  const decided = await db
    .selectFrom('referral')
    .innerJoin('quote', 'quote.id', 'referral.quote_id')
    .select([
      'quote.id as quote_id',
      'quote.program_id',
      'quote.activity_id',
      'quote.input',
      'quote.premium',
      'referral.decision',
      'referral.decided_at',
    ])
    .where('referral.state', '=', 'decided')
    .where('quote.product_id', '=', quote.product_id)
    .where('quote.id', '!=', quote.id)
    .orderBy('referral.decided_at', 'desc')
    .limit(SCAN)
    .execute();
  const activities = await getActivities(
    db,
    decided.map((d) => d.activity_id),
  );

  return decided
    .flatMap((d) => {
      const theirs = d.input as QuoteView['input'];
      const them = activities.get(d.activity_id);
      const action = (d.decision as { action?: Comparable['action'] } | null)?.action;
      if (!them || !action || !d.decided_at) return [];
      const distance =
        (them.id === activity.id ? 0 : 1.5) +
        Math.abs(Math.log(theirs.participants / mine.participants)) +
        0.5 * Math.abs(Math.log(theirs.hours / mine.hours));
      return [
        {
          quoteId: d.quote_id,
          programId: d.program_id,
          activityTitle: them.title,
          riskClass: theirs.pricedClass,
          participants: theirs.participants,
          hours: theirs.hours,
          action,
          totalCents: (d.premium as PremiumBreakdown | null)?.totalCents ?? null,
          decidedAt: d.decided_at.toISOString(),
          distance: Math.round(distance * 1000) / 1000,
        },
      ];
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, k);
}
