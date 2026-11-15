import type { Kysely } from 'kysely';
import type { Database } from '../../db/types.js';
import type { PolicySnapshot } from '../../domain/types.js';
import type { LlmProvider } from '../intake/index.js';
import { getProgram, getProgramRules, type ProgramView } from '../programs/index.js';
import { type Intent, intentFromModel, intentOf, POLICY_NUMBER } from './intents.js';

export interface BotDeps {
  db: Kysely<Database>;
  llm: LlmProvider;
  clock: () => Date;
}

/** A policy as the bot may name it: no person's details. */
export interface PolicyRef {
  id: string;
  policyNumber: string;
  startsAt: string;
  endsAt: string;
}

/** Who is writing and where: the program's portal, the signed-in renter if any, and the channel. */
export interface BotConversation {
  programId: string;
  renterId: string | null;
  channel: 'web' | 'telegram';
}

export interface BotTurn {
  intent: Intent;
  reply: string;
  /** Set when a person must take over; `context` is what they need to pick it up. */
  handover?: { reason: Intent; context: Record<string, unknown> };
}

const EMAIL = /[^\s,;<>()]+@[^\s,;<>()]+\.[a-z]{2,}/gi;
const date = (iso: string) =>
  new Date(iso).toLocaleDateString('en-CA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
const million = (cents: number) => `$${cents / 100_000_000}M`;

export function greeting(program: Pick<ProgramView, 'name'>): string {
  return `Hello, this is the ${program.name} assistant. I can tell you what is covered here, how to get a price and where your policy stands. A person takes over whenever you ask, for a claim, or when I cannot help.`;
}

function status(policy: PolicyRef, now: Date): string {
  if (now < new Date(policy.startsAt)) return `starts ${date(policy.startsAt)}`;
  if (now <= new Date(policy.endsAt)) return `is in force until ${date(policy.endsAt)}`;
  return `ended ${date(policy.endsAt)}`;
}

const refOf = (row: { id: string; policy_number: string; starts_at: Date; ends_at: Date }) => ({
  id: row.id,
  policyNumber: row.policy_number,
  startsAt: row.starts_at.toISOString(),
  endsAt: row.ends_at.toISOString(),
});

// What a message and its sender show about a policy: nothing named, a number that is not on this portal, a policy the
// sender has not shown to be theirs, or one they have (signed in, or its number with the e-mail on it).
type PolicyLookup =
  | { kind: 'none' }
  | { kind: 'unknown'; number: string }
  | { kind: 'unproven'; policy: PolicyRef }
  | { kind: 'proven'; policy: PolicyRef };

async function policyFor(
  db: Kysely<Database>,
  programId: string,
  renterId: string | null,
  text: string,
): Promise<PolicyLookup> {
  const number = POLICY_NUMBER.exec(text)?.[1]?.toUpperCase() ?? null;
  let query = db
    .selectFrom('policy')
    .innerJoin('quote', 'quote.id', 'policy.quote_id')
    .select([
      'policy.id',
      'policy.policy_number',
      'policy.starts_at',
      'policy.ends_at',
      'policy.snapshot',
      'quote.renter_id',
    ])
    .where('policy.program_id', '=', programId);
  if (number) query = query.where('policy.policy_number', '=', number);
  else if (renterId) query = query.where('quote.renter_id', '=', renterId);
  else return { kind: 'none' };
  const row = await query.orderBy('policy.issued_at', 'desc').limit(1).executeTakeFirst();
  if (!row) return number ? { kind: 'unknown', number } : { kind: 'none' };
  const holder = (row.snapshot as PolicySnapshot).holder.email.toLowerCase();
  const emails = (text.match(EMAIL) ?? []).map((e) => e.toLowerCase());
  const proven = (renterId !== null && row.renter_id === renterId) || emails.includes(holder);
  return { kind: proven ? 'proven' : 'unproven', policy: refOf(row) };
}

// Why a policy is not opened. Signing in is a way to prove it only on the web.
function refusal(
  found: Extract<PolicyLookup, { kind: 'unknown' | 'unproven' }>,
  channel: BotConversation['channel'],
): string {
  if (found.kind === 'unknown') {
    return `I cannot find policy ${found.number} on this portal. Check the number on your confirmation e-mail.`;
  }
  const how = channel === 'web' ? 'sign in, or send' : 'send';
  return `For your privacy I only open a policy for its holder: ${how} ${found.policy.policyNumber} with the e-mail on the policy.`;
}

/** The answer to a policy number sent while a person has yet to pick the case up: the policy joins the case, but only for
 * its holder. Null when the message names no policy. */
export async function policyNote(
  db: Kysely<Database>,
  conversation: BotConversation,
  text: string,
): Promise<{ reply: string; policy?: PolicyRef } | null> {
  if (!POLICY_NUMBER.test(text)) return null;
  const found = await policyFor(db, conversation.programId, conversation.renterId, text);
  if (found.kind === 'none') return null;
  if (found.kind !== 'proven') return { reply: refusal(found, conversation.channel) };
  return {
    reply: `I have added policy ${found.policy.policyNumber} to your case for the person who picks it up.`,
    policy: found.policy,
  };
}

async function coverWords(db: Kysely<Database>, program: ProgramView, now: Date): Promise<string> {
  const rules = await getProgramRules(db, program.id, now.toISOString().slice(0, 10));
  const limits = rules.limitsCents.map(million).join(' or ');
  const alcohol = rules.alcoholAuto
    ? 'with alcohol included'
    : 'and an event with alcohol goes to an underwriter';
  return `At ${program.name}, events up to ${rules.maxParticipantsAuto} people are priced on the spot, ${alcohol}. The liability limits offered are ${limits}. Anything outside that goes to an underwriter, who decides with the reasons. Your policy and its certificates say exactly what is covered.`;
}

function hoursLine(program: ProgramView): string {
  return program.contacts?.hours ? ` They answer ${program.contacts.hours}.` : '';
}

// One turn of the bot: what it says, and whether a person must take over. It answers only from the program's own data;
// what it cannot answer goes to a person rather than to a guess.
export async function botTurn(
  deps: BotDeps,
  conversation: BotConversation,
  original: string,
  protectedText: string,
): Promise<BotTurn> {
  const now = deps.clock();
  const program = await getProgram(deps.db, conversation.programId);
  if (!program)
    throw new Error(`program ${conversation.programId} of a conversation does not exist`);
  const intent = intentOf(original) ?? (await intentFromModel(deps.llm, protectedText));
  // A claim or a refund is easier to pick up with its policy, so a renter who has not named one is asked, once.
  const askPolicy =
    ' If you have a policy number, send it here with the e-mail on it and I will add it to your case.';
  const handover = (
    reason: Intent,
    reply: string,
    context: Record<string, unknown> = {},
    asking = false,
  ) => ({
    intent,
    reply: `${reply}${hoursLine(program)}${asking ? askPolicy : ''} You can keep writing here.`,
    handover: { reason, context: { reason, ...context } },
  });

  switch (intent) {
    case 'claim':
    case 'refund': {
      const found = await policyFor(deps.db, program.id, conversation.renterId, original);
      const policy = found.kind === 'proven' ? found.policy : null;
      const attached = policy ? ` with policy ${policy.policyNumber}` : '';
      const said =
        intent === 'claim'
          ? `I am sorry to hear that. A person at ${program.name} handles claims, and I have passed this on${attached}.`
          : `Cancellations and refunds are decided by a person at ${program.name}; I have passed this on${attached}.`;
      return handover(intent, said, policy ? { policy } : {}, !policy);
    }
    case 'human':
      return handover('human', `I have asked a person at ${program.name} to take over.`);
    case 'policy': {
      const found = await policyFor(deps.db, program.id, conversation.renterId, original);
      if (found.kind === 'proven') {
        return {
          intent,
          reply: `Policy ${found.policy.policyNumber} ${status(found.policy, now)}. Its certificates are on the policy page of this portal.`,
        };
      }
      if (found.kind === 'none') {
        return {
          intent,
          reply:
            conversation.channel === 'web'
              ? 'Sign in to see your policies here, or send me the policy number with the e-mail on it.'
              : `Send me the policy number, like ${program.code}-000123, with the e-mail on it.`,
        };
      }
      return { intent, reply: refusal(found, conversation.channel) };
    }
    case 'price':
      return {
        intent,
        reply:
          'To get a price, describe your event on the first page of this portal in your own words: what it is, how many people, how long and whether alcohol is served. Most events are priced in a minute; anything unusual goes to an underwriter with the reasons.',
      };
    case 'cover':
      return { intent, reply: await coverWords(deps.db, program, now) };
    case 'contact': {
      const c = program.contacts;
      const ways = [c?.supportEmail, c?.supportPhone, c?.telegram].filter(Boolean).join(', ');
      return {
        intent,
        reply: ways
          ? `You can reach ${program.name} at ${ways}.${hoursLine(program)}`
          : `Write here and I will pass it to a person at ${program.name}.`,
      };
    }
    case 'thanks':
      return { intent, reply: 'You are welcome.' };
    case 'greeting':
      return { intent, reply: greeting(program) };
    default:
      return handover(
        'other',
        `I cannot answer that one myself, so I have passed it to a person at ${program.name}.`,
      );
  }
}
