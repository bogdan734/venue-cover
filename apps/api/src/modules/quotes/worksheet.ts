import type { Kysely } from 'kysely';
import type { Database } from '../../db/types.js';
import type { PremiumBreakdown, QuoteDetails } from '../../domain/types.js';
import { HttpError } from '../../http/errors.js';
import type { Principal } from '../auth/index.js';
import { getActivity } from '../catalogue/index.js';
import { type ClassificationRecord, getClassificationRecord } from '../intake/index.js';
import { getProgram } from '../programs/index.js';
import { breakdownFromNet } from '../rating/index.js';
import {
  buildWorksheet,
  DEFAULT_FACTORS,
  type Worksheet,
  type WorksheetFacts,
} from '../underwriting/index.js';
import { type Comparable, comparablesFor } from './comparables.js';
import type { QuoteRow, QuoteView } from './service.js';

export interface WorksheetView extends Worksheet {
  referralId: string;
  quoteId: string;
  /** The premium the worksheet total produces once the program's loading, fee and tax are applied. */
  proposed: PremiumBreakdown;
  comparables: Comparable[];
}

// What the quote, its description and a large-event application say. Anything an application did not give is left out,
// so the worksheet shows it as "not provided".
export function factsOf(
  quote: QuoteRow,
  classification: ClassificationRecord | null,
): WorksheetFacts {
  const input = quote.input as QuoteView['input'];
  const details = (quote.details as QuoteDetails | null) ?? {};
  return {
    dailyPeak: details.dailyPeak ?? input.participants,
    alcohol: input.alcohol,
    flags: [...new Set([...(classification?.facts.flags ?? []), ...(details.flags ?? [])])],
    vendors: details.vendors,
    temporarySeats: details.temporarySeats,
    priorClaims: details.priorClaims,
    serverTraining: details.serverTraining,
  };
}

export async function getWorksheet(
  db: Kysely<Database>,
  p: Principal,
  referralId: string,
): Promise<WorksheetView> {
  const ref = await db
    .selectFrom('referral')
    .selectAll()
    .where('id', '=', referralId)
    .executeTakeFirst();
  const quote =
    ref &&
    (await db.selectFrom('quote').selectAll().where('id', '=', ref.quote_id).executeTakeFirst());
  if (!ref || !quote || (p.programId !== null && p.programId !== quote.program_id)) {
    throw new HttpError(404, 'referral_not_found', `no referral ${referralId}`);
  }
  const base = quote.premium as PremiumBreakdown | null;
  if (!base)
    throw new HttpError(409, 'no_price', 'this quote has no rate card premium to start from');

  const activity = await getActivity(db, quote.activity_id);
  const program = await getProgram(db, quote.program_id);
  if (!activity || !program)
    throw new Error(`referral ${referralId} points at a missing activity or program`);
  const classification = quote.classification_id
    ? ((await getClassificationRecord(db, quote.classification_id, null)) ?? null)
    : null;

  const worksheet = buildWorksheet(factsOf(quote, classification), DEFAULT_FACTORS, base.netCents);
  return {
    referralId,
    quoteId: quote.id,
    ...worksheet,
    proposed: breakdownFromNet(
      worksheet.netTotalCents,
      program.terms,
      program.province,
      base.rateRowId,
    ),
    comparables: await comparablesFor(db, quote, activity, 5),
  };
}
