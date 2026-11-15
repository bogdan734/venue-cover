import type { Kysely, Selectable, Transaction } from 'kysely';
import type { Database } from '../../db/types.js';
import { newId } from '../../domain/ids.js';
import type {
  AnswerMap,
  Contact,
  PolicySnapshot,
  PremiumBreakdown,
  QuoteDetails,
  QuoteState,
  ReferralReason,
  RiskClass,
  ScreeningResult,
} from '../../domain/types.js';
import { HttpError } from '../../http/errors.js';
import type { PaymentProvider } from '../../providers/payments.js';
import type { Principal } from '../auth/index.js';
import { type ActivityView, getActivities, getActivity } from '../catalogue/index.js';
import { appendEvent } from '../events/index.js';
import { type ClassificationRecord, getClassificationRecord } from '../intake/index.js';
import { getPoliciesByQuote, issuePolicy } from '../policies/index.js';
import {
  getProgram,
  getProgramRules,
  getVenue,
  type ProgramView,
  resolveRouting,
  venueBelongsToProgram,
} from '../programs/index.js';
import {
  answersToReasons,
  checkAnswers,
  nextQuestions,
  type QuestionContext,
} from '../questions/index.js';
import { loadRateRows, NoRateError, OverMaxHoursError, rate } from '../rating/index.js';
import { type DecisionInput, decide, screenName, sortReasons } from '../underwriting/index.js';
import { IllegalTransitionError, transition } from './machine.js';
import { openReferral, referralReasons } from './referrals.js';
import type { QuoteInput } from './schema.js';

export const QUOTE_TTL_MS = 30 * 24 * 3600_000;

const RANK: Record<RiskClass, number> = { A: 0, B: 1, C: 2, X: 3 };

export interface QuoteView {
  id: string;
  programId: string;
  state: QuoteState;
  activityId: string;
  productId: string;
  venueId: string | null;
  classificationId: string | null;
  input: Pick<
    QuoteInput,
    'participants' | 'hours' | 'alcohol' | 'eventDate' | 'startTime' | 'limitCents'
  > & {
    /** The risk class the price was built on: the highest class seen, which can exceed the chosen activity's. */
    pricedClass: RiskClass;
    answers: AnswerMap;
  };
  premium: PremiumBreakdown | null;
  holder: QuoteInput['holder'];
  bookingRef: string | null;
  referralReasons: ReferralReason[];
  createdAt: string;
  expiresAt: string;
}

export type QuoteRow = Selectable<Database['quote']>;

export function requireProgram(p: Principal): string {
  if (!p.programId) throw new HttpError(403, 'forbidden', 'the API key is not bound to a program');
  return p.programId;
}

// A paused program keeps its policies and claims but takes no new quotes and binds none it already gave.
function assertTakesBusiness(program: ProgramView): void {
  if (program.status === 'paused') {
    throw new HttpError(
      409,
      'program_paused',
      `${program.name} is not taking new business just now`,
    );
  }
}

// A quote whose time has run out reads as expired whether or not anyone touched it.
export function effectiveState(row: QuoteRow, now: Date): QuoteState {
  const open = row.state === 'quoted' || row.state === 'referred';
  return open && row.expires_at.getTime() <= now.getTime() ? 'expired' : row.state;
}

export function toView(row: QuoteRow, reasons: ReferralReason[], now: Date): QuoteView {
  return {
    id: row.id,
    programId: row.program_id,
    state: effectiveState(row, now),
    activityId: row.activity_id,
    productId: row.product_id,
    venueId: row.venue_id,
    classificationId: row.classification_id,
    input: row.input as QuoteView['input'],
    premium: row.premium as PremiumBreakdown | null,
    holder: row.holder as QuoteView['holder'],
    bookingRef: row.booking_ref,
    referralReasons: reasons,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
  };
}

// A price (indicative when `reasons` is not empty) and the reasons it needs a person. Class X has no rate by design.
// An event larger than the largest band is priced at that band and flagged; the underwriter's worksheet adds the rest.
interface Priced {
  premium: PremiumBreakdown | null;
  reasons: ReferralReason[];
}

export async function priceQuote(
  db: Kysely<Database>,
  activity: ActivityView,
  riskClass: RiskClass,
  input: Pick<QuoteInput, 'participants' | 'hours' | 'alcohol' | 'eventDate' | 'limitCents'>,
  program: ProgramView,
): Promise<Priced> {
  if (riskClass === 'X') return { premium: null, reasons: [] };
  const rows = await loadRateRows(db, activity.product.id, input.eventDate);
  const ratingInput = {
    product: activity.product,
    riskClass,
    limitCents: input.limitCents,
    alcohol: input.alcohol,
    participants: input.participants,
    hours: input.hours,
    province: program.province,
    eventDate: input.eventDate,
  };
  try {
    return { premium: rate(ratingInput, rows, program.terms), reasons: [] };
  } catch (error) {
    if (error instanceof OverMaxHoursError) return { premium: null, reasons: ['OVER_CAPACITY'] };
    if (error instanceof NoRateError) {
      if (error.aboveLargestBand && error.largestBand !== null) {
        const premium = rate(
          { ...ratingInput, participants: error.largestBand },
          rows,
          program.terms,
        );
        return { premium, reasons: ['OVER_CAPACITY'] };
      }
      return { premium: null, reasons: ['NO_RATE'] };
    }
    throw error;
  }
}

// What the underwriting rules see: the description (when there is one) together with what the customer confirmed.
export function decisionInput(
  activity: ActivityView,
  input: Pick<QuoteInput, 'participants' | 'hours' | 'alcohol'>,
  classification: ClassificationRecord | null,
  screen: ScreeningResult,
): DecisionInput {
  const accepted = classification?.phrases.flatMap((p) => (p.accepted ? [p.accepted] : [])) ?? [];
  const classes = [...accepted.map((a) => a.riskClass), activity.riskClass];
  const riskClass = classes.reduce((a, b) => (RANK[b] > RANK[a] ? b : a));
  return {
    riskClass,
    classes,
    activityIds: [...accepted.map((a) => a.activityId), activity.id],
    confidence: classification?.confidence ?? 1,
    unknownPhrases: classification
      ? classification.phrases.length === 0
        ? 1
        : classification.phrases.length - accepted.length
      : 0,
    degraded: classification?.degraded ?? false,
    flags: classification?.facts.flags ?? [],
    participants: input.participants,
    hours: input.hours,
    alcohol: input.alcohol,
    screen,
  };
}

// Runs inside the caller's transaction so that the quote, its referral and its events commit together.
export async function createQuote(
  trx: Transaction<Database>,
  p: Principal,
  input: QuoteInput,
  now: Date,
  details?: QuoteDetails,
  /** The signed-in renter the quote belongs to, if any. */
  renterId: string | null = null,
): Promise<QuoteView> {
  const programId = requireProgram(p);
  const today = now.toISOString().slice(0, 10);
  if (input.eventDate < today) {
    throw new HttpError(400, 'event_in_the_past', 'the event date is in the past');
  }
  const activity = await getActivity(trx, input.activityId);
  if (!activity) throw new HttpError(404, 'activity_not_found', `no activity ${input.activityId}`);
  const program = await getProgram(trx, programId);
  if (!program) throw new Error(`program ${programId} of the API key does not exist`);
  assertTakesBusiness(program);
  if (input.venueId && !(await venueBelongsToProgram(trx, input.venueId, programId))) {
    throw new HttpError(
      400,
      'venue_not_in_program',
      `venue ${input.venueId} is not part of this program`,
    );
  }
  const classification = input.classificationId
    ? await getClassificationRecord(trx, input.classificationId, programId)
    : null;
  if (input.classificationId && !classification) {
    throw new HttpError(
      404,
      'classification_not_found',
      `no classification ${input.classificationId}`,
    );
  }

  const screen = await screenName(trx, input.holder.name);
  const rules = await getProgramRules(trx, programId, today);
  if (!rules.limitsCents.includes(input.limitCents)) {
    throw new HttpError(
      400,
      'limit_not_offered',
      `this program does not offer a limit of ${input.limitCents / 100} dollars`,
    );
  }
  const basis = decisionInput(activity, input, classification ?? null, screen);
  const decision = decide(basis, rules);
  // Priced at the highest class seen, so that mentioning a risky extra cannot make the event cheaper.
  const pricedClass = basis.riskClass ?? activity.riskClass;
  const priced = await priceQuote(trx, activity, pricedClass, input, program);

  // The program's own questions: an answer it flags refers the quote, and a question that applies but was not answered
  // counts as missing information, so leaving one out cannot skip the check.
  const answers = input.answers ?? {};
  const problems = checkAnswers(rules.questions, answers);
  if (problems.length > 0) throw new HttpError(400, 'invalid_answers', problems.join('; '));
  const questionContext: QuestionContext = {
    facts: {
      participants: input.participants,
      hours: input.hours,
      alcohol: input.alcohol,
      flags: classification?.facts.flags ?? [],
    },
    riskClass: pricedClass,
    productCode: activity.product.code,
  };
  const questionReasons: ReferralReason[] = [
    ...answersToReasons(rules.questions, questionContext, answers),
    ...(nextQuestions(rules.questions, questionContext, answers).length > 0
      ? (['MISSING_FACTS'] as const)
      : []),
  ];

  const premium = priced.premium;
  const reasons = sortReasons([...decision.reasons, ...questionReasons, ...priced.reasons]);
  const state: QuoteState = reasons.length === 0 ? 'quoted' : 'referred';
  const id = newId('qte');
  await trx
    .insertInto('quote')
    .values({
      id,
      program_id: programId,
      renter_id: renterId,
      venue_id: input.venueId ?? null,
      product_id: activity.product.id,
      activity_id: activity.id,
      classification_id: classification?.id ?? null,
      state,
      input: JSON.stringify({
        participants: input.participants,
        hours: input.hours,
        alcohol: input.alcohol,
        eventDate: input.eventDate,
        startTime: input.startTime,
        limitCents: input.limitCents,
        pricedClass,
        answers,
      }),
      premium: premium ? JSON.stringify(premium) : null,
      holder: JSON.stringify(input.holder),
      details: details ? JSON.stringify(details) : null,
      booking_ref: input.bookingRef ?? null,
      created_at: now,
      expires_at: new Date(now.getTime() + QUOTE_TTL_MS),
    })
    .execute();

  await appendEvent(trx, {
    type: 'quote.created',
    programId,
    data: { quoteId: id, state, totalCents: premium?.totalCents ?? null },
  });
  if (state === 'referred') {
    await openReferral(trx, id, reasons, now);
    await appendEvent(trx, { type: 'quote.referred', programId, data: { quoteId: id, reasons } });
  }
  return getQuote(trx, p, id, now);
}

export async function getQuote(
  db: Kysely<Database>,
  p: Principal,
  id: string,
  now: Date,
): Promise<QuoteView> {
  const programId = requireProgram(p);
  const row = await db
    .selectFrom('quote')
    .selectAll()
    .where('id', '=', id)
    .where('program_id', '=', programId)
    .executeTakeFirst();
  if (!row) throw new HttpError(404, 'quote_not_found', `no quote ${id}`);
  return toView(row, await referralReasons(db, row.id), now);
}

// The charge uses the quote id as its reference, so a retry after a failed commit cannot charge twice.
export async function bindQuote(
  trx: Transaction<Database>,
  p: Principal,
  quoteId: string,
  paymentToken: string,
  payment: PaymentProvider,
  now: Date,
  /** The signed-in renter paying, if any: a quote of theirs, or a guest's quote they take over by paying. */
  renterId: string | null = null,
): Promise<{ policyId: string; policyNumber: string }> {
  const programId = requireProgram(p);
  const row = await trx
    .selectFrom('quote')
    .selectAll()
    .where('id', '=', quoteId)
    .where('program_id', '=', programId)
    .forUpdate()
    .executeTakeFirst();
  if (!row) throw new HttpError(404, 'quote_not_found', `no quote ${quoteId}`);
  if (row.renter_id !== null && renterId !== null && row.renter_id !== renterId) {
    throw new HttpError(403, 'not_your_quote', 'this quote belongs to another account');
  }
  if (effectiveState(row, now) === 'expired') {
    throw new HttpError(409, 'quote_expired', 'the quote has expired');
  }
  if (renterId !== null && row.renter_id === null) {
    await trx.updateTable('quote').set({ renter_id: renterId }).where('id', '=', quoteId).execute();
  }

  let next: QuoteState;
  try {
    next = transition(row.state, 'pay');
  } catch (error) {
    if (error instanceof IllegalTransitionError) {
      throw new HttpError(409, 'illegal_transition', error.message);
    }
    throw error;
  }

  const premium = row.premium as PremiumBreakdown;
  const result = await payment.charge({
    amountCents: premium.totalCents,
    reference: quoteId,
    token: paymentToken,
  });
  if (result.status === 'declined') throw new HttpError(402, 'payment_declined', result.reason);

  const program = await getProgram(trx, programId);
  if (!program) throw new Error(`program ${programId} does not exist`);
  assertTakesBusiness(program);
  const input = row.input as QuoteView['input'];
  const activity = await getActivity(trx, row.activity_id);
  if (!activity) throw new Error(`activity ${row.activity_id} of quote ${quoteId} does not exist`);
  // Routing is decided now and frozen in the policy: the booking reference says who else gets a certificate.
  const routing = await resolveRouting(trx, programId, row.booking_ref);
  const venue = routing.venue
    ? { id: routing.venue.id, name: routing.venue.name }
    : row.venue_id
      ? ((await getVenue(trx, row.venue_id)) ?? null)
      : null;
  const snapshot: PolicySnapshot = {
    holder: row.holder as Contact,
    programName: program.name,
    activityTitle: activity.title,
    venue,
    bookingRef: row.booking_ref,
    limitCents: input.limitCents,
    participants: input.participants,
    hours: input.hours,
    alcohol: input.alcohol,
    premium,
    recipients: {
      venue: routing.venue ? { name: routing.venue.name, email: routing.venue.email } : null,
      broker: routing.broker,
    },
    routed: routing.routed,
  };
  const startsAt = new Date(`${input.eventDate}T${input.startTime}:00Z`);
  const policy = await issuePolicy(trx, {
    quoteId,
    programId,
    programCode: program.code,
    totalCents: premium.totalCents,
    startsAt,
    endsAt: new Date(startsAt.getTime() + Math.ceil(input.hours) * 3600_000),
    snapshot,
  });
  await trx.updateTable('quote').set({ state: next }).where('id', '=', quoteId).execute();
  return policy;
}

export interface PreviewQuote {
  quoteId: string;
  activity: ActivityView;
  input: QuoteView['input'];
  classification: ClassificationRecord | null;
}

// The most recent quotes of a program with what the decision needs, so a rule change can be tried on real history.
export async function quotesForPreview(
  db: Kysely<Database>,
  programId: string,
  limit: number,
): Promise<PreviewQuote[]> {
  const rows = await db
    .selectFrom('quote')
    .selectAll()
    .where('program_id', '=', programId)
    .orderBy('created_at', 'desc')
    .limit(limit)
    .execute();
  const activities = await getActivities(
    db,
    rows.map((r) => r.activity_id),
  );
  const out: PreviewQuote[] = [];
  for (const row of rows) {
    const activity = activities.get(row.activity_id);
    if (!activity) continue;
    out.push({
      quoteId: row.id,
      activity,
      input: row.input as QuoteView['input'],
      classification: row.classification_id
        ? ((await getClassificationRecord(db, row.classification_id, null)) ?? null)
        : null,
    });
  }
  return out;
}

export interface RenterQuote {
  id: string;
  programId: string;
  state: QuoteState;
  activityTitle: string;
  eventDate: string;
  totalCents: number | null;
  createdAt: string;
  policy: { id: string; policyNumber: string } | null;
}

// A renter's quotes across every program, newest first, with the policy each one became.
export async function quotesOfRenter(
  db: Kysely<Database>,
  renterId: string,
  now: Date,
): Promise<RenterQuote[]> {
  const rows = await db
    .selectFrom('quote')
    .selectAll()
    .where('renter_id', '=', renterId)
    .orderBy('created_at', 'desc')
    .limit(100)
    .execute();
  const [activities, policies] = await Promise.all([
    getActivities(
      db,
      rows.map((r) => r.activity_id),
    ),
    getPoliciesByQuote(
      db,
      rows.map((r) => r.id),
    ),
  ]);
  return rows.map((row) => {
    const policy = policies.get(row.id);
    return {
      id: row.id,
      programId: row.program_id,
      state: effectiveState(row, now),
      activityTitle: activities.get(row.activity_id)?.title ?? '',
      eventDate: (row.input as QuoteView['input']).eventDate,
      totalCents: (row.premium as PremiumBreakdown | null)?.totalCents ?? null,
      createdAt: row.created_at.toISOString(),
      policy: policy ? { id: policy.id, policyNumber: policy.policyNumber } : null,
    };
  });
}
