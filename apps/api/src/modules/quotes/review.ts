import type { Kysely, Selectable, Transaction } from 'kysely';
import type { Database } from '../../db/types.js';
import type { PremiumBreakdown, ReferralReason, RiskClass } from '../../domain/types.js';
import { HttpError } from '../../http/errors.js';
import type { Principal } from '../auth/index.js';
import { type ActivityView, getActivities, getActivity } from '../catalogue/index.js';
import { appendEvent } from '../events/index.js';
import { type ClassificationRecord, getClassificationRecord } from '../intake/index.js';
import type { Shield } from '../privacy/index.js';
import { getProgram } from '../programs/index.js';
import { breakdownFromNet } from '../rating/index.js';
import {
  applyEdits,
  buildWorksheet,
  DEFAULT_FACTORS,
  recordLabelledExample,
  type WorksheetLine,
} from '../underwriting/index.js';
import { IllegalTransitionError, transition } from './machine.js';
import type { UnderwriterDecisionInput } from './schema.js';
import { priceQuote, QUOTE_TTL_MS, type QuoteRow, type QuoteView, toView } from './service.js';
import { type Sla, slaStatus } from './sla.js';
import { factsOf } from './worksheet.js';

type ReferralRow = Selectable<Database['referral']>;

export interface ReferralView {
  id: string;
  quoteId: string;
  programId: string;
  state: 'open' | 'claimed' | 'decided';
  reasons: ReferralReason[];
  claimedBy: string | null;
  dueAt: string;
  createdAt: string;
  decidedAt: string | null;
  /** null once decided. */
  sla: Sla | null;
  decision: unknown;
  activity: { id: string; title: string; riskClass: RiskClass; productCode: string };
  quote: QuoteView;
}

export interface ReferralDetail extends ReferralView {
  classification: ClassificationRecord | null;
}

// Underwriters hold a key without a program and see everything; a program key sees its own program only.
const visible = (p: Principal, quote: QuoteRow) =>
  p.programId === null || p.programId === quote.program_id;

function toReferralView(
  ref: ReferralRow,
  quote: QuoteRow,
  activity: ActivityView,
  now: Date,
): ReferralView {
  const reasons = ref.reasons as ReferralReason[];
  return {
    id: ref.id,
    quoteId: ref.quote_id,
    programId: quote.program_id,
    state: ref.state,
    reasons,
    claimedBy: ref.claimed_by,
    dueAt: ref.due_at.toISOString(),
    createdAt: ref.created_at.toISOString(),
    decidedAt: ref.decided_at?.toISOString() ?? null,
    sla: ref.state === 'decided' ? null : slaStatus(ref.due_at, now),
    decision: ref.decision,
    activity: {
      id: activity.id,
      title: activity.title,
      riskClass: activity.riskClass,
      productCode: activity.product.code,
    },
    quote: toView(quote, reasons, now),
  };
}

async function loadView(
  db: Kysely<Database>,
  p: Principal,
  id: string,
  now: Date,
): Promise<ReferralView> {
  const ref = await db.selectFrom('referral').selectAll().where('id', '=', id).executeTakeFirst();
  const quote =
    ref &&
    (await db.selectFrom('quote').selectAll().where('id', '=', ref.quote_id).executeTakeFirst());
  const activity = quote && (await getActivity(db, quote.activity_id));
  if (!ref || !quote || !activity || !visible(p, quote)) {
    throw new HttpError(404, 'referral_not_found', `no referral ${id}`);
  }
  return toReferralView(ref, quote, activity, now);
}

export async function listReferrals(
  db: Kysely<Database>,
  p: Principal,
  now: Date,
  states: ReferralRow['state'][],
): Promise<ReferralView[]> {
  let query = db.selectFrom('referral').selectAll().where('state', 'in', states);
  if (p.programId) {
    const programId = p.programId;
    query = query.where(
      'quote_id',
      'in',
      db.selectFrom('quote').select('id').where('program_id', '=', programId),
    );
  }
  const refs = await query.orderBy('due_at').limit(200).execute();
  if (refs.length === 0) return [];
  const quotes = await db
    .selectFrom('quote')
    .selectAll()
    .where(
      'id',
      'in',
      refs.map((r) => r.quote_id),
    )
    .execute();
  const quoteById = new Map(quotes.map((q) => [q.id, q]));
  const activities = await getActivities(
    db,
    quotes.map((q) => q.activity_id),
  );
  return refs.flatMap((ref) => {
    const quote = quoteById.get(ref.quote_id);
    const activity = quote && activities.get(quote.activity_id);
    return quote && activity ? [toReferralView(ref, quote, activity, now)] : [];
  });
}

// The description comes with its personal details for an underwriter whose key may see them, and as tags otherwise.
export async function getReferral(
  db: Kysely<Database>,
  p: Principal,
  id: string,
  now: Date,
  shield: Shield,
): Promise<ReferralDetail> {
  const view = await loadView(db, p, id, now);
  const classificationId = view.quote.classificationId;
  const classification = classificationId
    ? await getClassificationRecord(db, classificationId, null, {
        shield,
        personal: p.scopes.includes('personal:read'),
      })
    : null;
  return { ...view, classification: classification ?? null };
}

async function lock(trx: Transaction<Database>, p: Principal, id: string) {
  const ref = await trx
    .selectFrom('referral')
    .selectAll()
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirst();
  const quote =
    ref &&
    (await trx
      .selectFrom('quote')
      .selectAll()
      .where('id', '=', ref.quote_id)
      .forUpdate()
      .executeTakeFirst());
  if (!ref || !quote || !visible(p, quote))
    throw new HttpError(404, 'referral_not_found', `no referral ${id}`);
  return { ref, quote };
}

// The row lock makes two simultaneous claims take turns: the second one sees the first and gets a 409.
export async function claimReferral(
  trx: Transaction<Database>,
  p: Principal,
  id: string,
  now: Date,
): Promise<ReferralView> {
  const { ref } = await lock(trx, p, id);
  if (ref.state === 'decided')
    throw new HttpError(409, 'already_decided', 'the referral is already decided');
  if (ref.state === 'claimed' && ref.claimed_by !== p.keyId) {
    throw new HttpError(409, 'already_claimed', 'another underwriter holds this referral');
  }
  if (ref.state === 'open') {
    await trx
      .updateTable('referral')
      .set({ state: 'claimed', claimed_by: p.keyId })
      .where('id', '=', id)
      .execute();
  }
  return loadView(trx, p, id, now);
}

export async function decideReferral(
  trx: Transaction<Database>,
  p: Principal,
  id: string,
  d: UnderwriterDecisionInput,
  now: Date,
): Promise<ReferralView> {
  const { ref, quote } = await lock(trx, p, id);
  if (ref.state === 'decided')
    throw new HttpError(409, 'already_decided', 'the referral is already decided');
  if (ref.state !== 'claimed' || ref.claimed_by !== p.keyId) {
    throw new HttpError(409, 'not_claimed_by_you', 'claim the referral before deciding it');
  }
  if (quote.expires_at.getTime() <= now.getTime()) {
    throw new HttpError(409, 'quote_expired', 'the quote has expired');
  }

  const original = await getActivity(trx, quote.activity_id);
  const program = await getProgram(trx, quote.program_id);
  if (!original || !program)
    throw new Error(`referral ${id} points at a missing activity or program`);
  const input = quote.input as QuoteView['input'];

  let activity = original;
  let premium = quote.premium as PremiumBreakdown | null;
  let pricedClass = input.pricedClass;
  if (d.action === 'approve_with_override') {
    if (d.activityId) {
      const chosen = await getActivity(trx, d.activityId);
      if (!chosen) throw new HttpError(404, 'activity_not_found', `no activity ${d.activityId}`);
      activity = chosen;
    }
    pricedClass = d.riskClass ?? (d.activityId ? activity.riskClass : pricedClass);
    const priced = await priceQuote(trx, activity, pricedClass, input, program);
    if (!priced.premium) {
      throw new HttpError(409, 'no_rate', 'that combination cannot be priced from the rate card');
    }
    premium = priced.premium;
  } else if (d.action === 'approve' && !premium) {
    throw new HttpError(409, 'no_price', 'this quote has no price; approve it with an override');
  }

  const classification = quote.classification_id
    ? await getClassificationRecord(trx, quote.classification_id, null)
    : null;

  // Edited worksheet lines set the net premium by hand; everything after the net follows the program's terms.
  let worksheet: WorksheetLine[] | null = null;
  if (d.lines && premium) {
    try {
      const edited = applyEdits(
        buildWorksheet(factsOf(quote, classification ?? null), DEFAULT_FACTORS, premium.netCents),
        d.lines,
      );
      worksheet = edited.lines;
      premium = breakdownFromNet(
        edited.netTotalCents,
        program.terms,
        program.province,
        premium.rateRowId,
      );
    } catch (error) {
      throw new HttpError(
        400,
        'invalid_worksheet',
        error instanceof Error ? error.message : 'the worksheet edits are not valid',
      );
    }
  }

  let next = quote.state;
  try {
    next = transition(quote.state, d.action === 'decline' ? 'decline' : 'approve');
  } catch (error) {
    if (error instanceof IllegalTransitionError)
      throw new HttpError(409, 'illegal_transition', error.message);
    throw error;
  }

  await trx
    .updateTable('quote')
    .set({
      state: next,
      premium: premium ? JSON.stringify(premium) : null,
      activity_id: activity.id,
      product_id: activity.product.id,
      input: JSON.stringify({ ...input, pricedClass }),
      // An approval starts a fresh validity period; a decline leaves the dates alone.
      ...(next === 'quoted' ? { expires_at: new Date(now.getTime() + QUOTE_TTL_MS) } : {}),
    })
    .where('id', '=', quote.id)
    .execute();
  await trx
    .updateTable('referral')
    .set({
      state: 'decided',
      decided_at: now,
      decision: JSON.stringify({
        action: d.action,
        riskClass: d.riskClass ?? null,
        activityId: d.activityId ?? null,
        note: d.note,
        decidedBy: p.keyId,
        worksheet,
      }),
    })
    .where('id', '=', id)
    .execute();

  await recordLabelledExample(trx, {
    text: classification?.maskedText ?? original.title,
    activityId: activity.id,
    riskClass: d.action === 'decline' ? 'X' : pricedClass,
  });
  await appendEvent(trx, {
    type: 'referral.decided',
    programId: quote.program_id,
    data: { referralId: id, quoteId: quote.id, action: d.action, state: next },
  });
  return loadView(trx, p, id, now);
}

// The referral of each quote in a set, as full views and keyed by quote id; used to resolve a nested field in one query.
export async function referralsByQuote(
  db: Kysely<Database>,
  p: Principal,
  quoteIds: string[],
  now: Date,
): Promise<Map<string, ReferralView>> {
  const out = new Map<string, ReferralView>();
  if (quoteIds.length === 0) return out;
  const refs = await db
    .selectFrom('referral')
    .selectAll()
    .where('quote_id', 'in', [...new Set(quoteIds)])
    .execute();
  if (refs.length === 0) return out;
  const quotes = await db
    .selectFrom('quote')
    .selectAll()
    .where(
      'id',
      'in',
      refs.map((r) => r.quote_id),
    )
    .execute();
  const quoteById = new Map(quotes.map((q) => [q.id, q]));
  const activities = await getActivities(
    db,
    quotes.map((q) => q.activity_id),
  );
  for (const ref of refs) {
    const quote = quoteById.get(ref.quote_id);
    const activity = quote && activities.get(quote.activity_id);
    if (quote && activity && visible(p, quote))
      out.set(ref.quote_id, toReferralView(ref, quote, activity, now));
  }
  return out;
}

export interface DecidedReferral {
  referralId: string;
  quoteId: string;
  programId: string;
  decidedAt: string;
  /** The masked description the quote was made from; null for a quote made straight from an activity. */
  text: string | null;
  decision: {
    action: 'approve' | 'approve_with_override' | 'decline';
    /** True when the underwriter edited worksheet lines. */
    edited: boolean;
  };
}

// The referrals decided since a moment, oldest first, with the description each quote was made from.
export async function decidedReferralsSince(
  db: Kysely<Database>,
  since: Date,
): Promise<DecidedReferral[]> {
  const rows = await db
    .selectFrom('referral')
    .innerJoin('quote', 'quote.id', 'referral.quote_id')
    .leftJoin('classification', 'classification.id', 'quote.classification_id')
    .select([
      'referral.id as referralId',
      'referral.quote_id as quoteId',
      'quote.program_id as programId',
      'referral.decided_at as decidedAt',
      'referral.decision',
      'classification.masked_text as text',
    ])
    .where('referral.state', '=', 'decided')
    .where('referral.decided_at', '>=', since)
    .orderBy('referral.decided_at')
    .orderBy('referral.id')
    .execute();
  return rows.map((row) => {
    const decision = row.decision as {
      action: DecidedReferral['decision']['action'];
      worksheet: unknown[] | null;
    };
    return {
      referralId: row.referralId,
      quoteId: row.quoteId,
      programId: row.programId,
      decidedAt: (row.decidedAt as Date).toISOString(),
      text: row.text,
      decision: {
        action: decision.action,
        edited: Array.isArray(decision.worksheet),
      },
    };
  });
}
