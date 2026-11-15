import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../../db/types.js';
import { newId } from '../../domain/ids.js';
import type { EventFlag, QuoteDetails } from '../../domain/types.js';
import { HttpError } from '../../http/errors.js';
import type { Principal } from '../auth/index.js';
import type { Embedder } from '../catalogue/index.js';
import { classifyEvent, type LlmProvider } from '../intake/index.js';
import type { Shield } from '../privacy/index.js';
import { createQuote } from '../quotes/index.js';
import { type AttachmentKind, type Completeness, checkCompleteness } from './completeness.js';
import { NoFormFieldsError, parseSubmission, type SubmissionFacts } from './parse.js';
import { draftReply } from './reply.js';

export interface SubmissionDeps {
  db: Kysely<Database>;
  llm: LlmProvider;
  embedder: Embedder;
  shield: Shield;
  clock: () => Date;
}

export interface ReceivedAttachment {
  kind: AttachmentKind;
  filename: string;
  size: number;
}

export interface SubmissionView {
  id: string;
  state: 'incomplete' | 'needs_review' | 'ready';
  missing: Completeness['missing'];
  requiredAttachments: AttachmentKind[];
  /** A draft for a person to send; the system never sends it. */
  draftReply: string;
  quoteId: string | null;
  unreadable: string[];
  attachments: ReceivedAttachment[];
  facts: SubmissionFacts;
}

// Flags the application itself admits to, in the same vocabulary the description reader uses.
function flagsOf(f: SubmissionFacts): EventFlag[] {
  const flags: EventFlag[] = [];
  if (f.pyrotechnics) flags.push('fireworks');
  if (f.overnight) flags.push('overnight');
  if ((f.vendors?.animal ?? 0) > 0) flags.push('animals');
  if ((f.vendors?.inflatable ?? 0) > 0) flags.push('inflatables');
  if ((f.shareUnder18 ?? 0) >= 0.5) flags.push('minors');
  return flags;
}

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

// Hours of cover: the length of one day's event, over every day. An end time before the start time means past midnight.
function totalHours(f: SubmissionFacts): number {
  let daily = minutes(f.endTime as string) - minutes(f.startTime as string);
  if (daily <= 0) daily += 24 * 60;
  return Math.round((daily / 60) * (f.eventDays ?? 1) * 100) / 100;
}

// Reads an application form and, when it is complete, turns it into a quote that goes to an underwriter with the
// vendors, seating and claims history for the worksheet. When it is not, it opens nothing and drafts the reply that
// asks for what is missing.
export async function receiveSubmission(
  deps: SubmissionDeps,
  trx: Transaction<Database>,
  p: Principal,
  upload: { form: Uint8Array; attachments: ReceivedAttachment[] },
): Promise<SubmissionView> {
  const programId = p.programId;
  if (!programId) throw new HttpError(403, 'forbidden', 'the API key is not bound to a program');

  let parsed: Awaited<ReturnType<typeof parseSubmission>>;
  try {
    parsed = await parseSubmission(upload.form);
  } catch (error) {
    if (error instanceof NoFormFieldsError)
      throw new HttpError(422, 'no_form_fields', error.message);
    throw new HttpError(400, 'unreadable_pdf', 'the file could not be read as a PDF form');
  }
  const { facts, unreadable } = parsed;
  const check = checkCompleteness(
    facts,
    upload.attachments.map((a) => a.kind),
  );

  let state: SubmissionView['state'] = check.ready ? 'ready' : 'incomplete';
  const missing = [...check.missing];
  let quoteId: string | null = null;

  if (check.ready) {
    const classification = await classifyEvent(deps, {
      text: facts.description as string,
      programId,
    });
    const activity = classification.primary;
    if (!activity) {
      state = 'needs_review';
      missing.push({
        field: 'activity',
        label: 'a person will confirm what kind of event this is',
      });
    } else {
      const liquorVendors = (facts.vendors?.liquor ?? 0) > 0;
      const details: QuoteDetails = {
        dailyPeak: facts.dailyMax as number,
        vendors: facts.vendors,
        temporarySeats: facts.temporarySeats,
        priorClaims: facts.priorClaims,
        serverTraining: facts.serverTraining,
        flags: flagsOf(facts),
      };
      const quote = await createQuote(
        trx,
        p,
        {
          activityId: activity.activityId,
          classificationId: classification.id,
          participants: facts.dailyMax as number,
          hours: totalHours(facts),
          alcohol: liquorVendors ? 'sold' : facts.alcoholServedBy === 'none' ? 'none' : 'served',
          eventDate: facts.eventDate as string,
          startTime: facts.startTime as string,
          limitCents:
            (facts.limitDollars as number) * 100 === 500_000_000 ? 500_000_000 : 200_000_000,
          holder: { name: facts.organizerName as string, email: facts.contactEmail as string },
          ...(facts.bookingRef ? { bookingRef: facts.bookingRef } : {}),
        },
        deps.clock(),
        details,
      );
      quoteId = quote.id;
    }
  }

  const id = newId('sub');
  await trx
    .insertInto('submission')
    .values({
      id,
      program_id: programId,
      state,
      facts: JSON.stringify(facts),
      missing: JSON.stringify(missing),
      attachments: JSON.stringify(upload.attachments),
      quote_id: quoteId,
    })
    .execute();

  return {
    id,
    state,
    missing,
    requiredAttachments: check.requiredAttachments,
    draftReply: draftReply({ ...check, missing, ready: state === 'ready' }, facts.organizerName),
    quoteId,
    unreadable,
    attachments: upload.attachments,
    facts,
  };
}

export async function getSubmission(
  db: Kysely<Database>,
  p: Principal,
  id: string,
): Promise<SubmissionView> {
  const row = await db.selectFrom('submission').selectAll().where('id', '=', id).executeTakeFirst();
  if (!row || (p.programId !== null && p.programId !== row.program_id)) {
    throw new HttpError(404, 'submission_not_found', `no submission ${id}`);
  }
  const facts = row.facts as SubmissionFacts;
  const attachments = row.attachments as ReceivedAttachment[];
  const check = checkCompleteness(
    facts,
    attachments.map((a) => a.kind),
  );
  const missing = row.missing as Completeness['missing'];
  return {
    id: row.id,
    state: row.state,
    missing,
    requiredAttachments: check.requiredAttachments,
    draftReply: draftReply(
      { ...check, missing, ready: row.state === 'ready' },
      facts.organizerName,
    ),
    quoteId: row.quote_id,
    unreadable: [],
    attachments,
    facts,
  };
}
