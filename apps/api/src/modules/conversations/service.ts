import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Kysely, Selectable } from 'kysely';
import type { Database } from '../../db/types.js';
import { newId } from '../../domain/ids.js';
import type { ConversationState } from '../../domain/types.js';
import { HttpError } from '../../http/errors.js';
import type { Principal } from '../auth/index.js';
import { open, reveal, type Shield, seal } from '../privacy/index.js';
import { getProgram } from '../programs/index.js';
import { type BotDeps, botTurn, greeting, policyNote } from './bot.js';
import type { TelegramBot } from './telegram.js';

export interface ConversationDeps extends BotDeps {
  shield: Shield;
  telegram?: TelegramBot;
}

export type ConversationRow = Selectable<Database['conversation']>;
type Sender = 'renter' | 'bot' | 'staff';

export interface Line {
  id: string;
  sender: Sender;
  text: string;
  at: string;
}

const hash = (secret: string) => createHash('sha256').update(secret).digest('hex');
export const canReadPersonal = (p: Principal) => p.scopes.includes('personal:read');
const notFound = (id: string) =>
  new HttpError(404, 'conversation_not_found', `no conversation ${id}`);

// Every line is stored as protected text with its originals sealed to the message, like a description. The line comes
// back as the caller may read it.
async function addLine(
  deps: Pick<ConversationDeps, 'db' | 'shield'>,
  conversation: Pick<ConversationRow, 'id' | 'program_id'>,
  sender: Sender,
  text: string,
  personal: boolean,
): Promise<Line & { protectedText: string }> {
  const id = newId('msg');
  const shielded = await deps.shield.protect(text, conversation.program_id);
  const vault = Object.keys(shielded.vault).length
    ? seal(shielded.vault, deps.shield.keys(conversation.program_id).seal, id)
    : null;
  const { at } = await deps.db
    .insertInto('message')
    .values({ id, conversation_id: conversation.id, sender, text: shielded.text, vault })
    .returning('at')
    .executeTakeFirstOrThrow();
  return {
    id,
    sender,
    text: personal ? text : shielded.text,
    at: at.toISOString(),
    protectedText: shielded.text,
  };
}

const asLine = ({ protectedText: _, ...line }: Line & { protectedText: string }): Line => line;

/** The lines of a conversation, oldest first, after a time when given; with the details as written for a key that may
 * read them, and as tags for one that may not. */
export async function linesOf(
  deps: Pick<ConversationDeps, 'db' | 'shield'>,
  conversation: Pick<ConversationRow, 'id' | 'program_id'>,
  personal: boolean,
  after?: string,
): Promise<Line[]> {
  let query = deps.db
    .selectFrom('message')
    .selectAll()
    .where('conversation_id', '=', conversation.id);
  if (after) query = query.where('at', '>', new Date(after));
  const rows = await query.orderBy('at').execute();
  const key = deps.shield.keys(conversation.program_id).seal;
  return rows.map((row) => ({
    id: row.id,
    sender: row.sender,
    text: personal && row.vault ? reveal(row.text, open(row.vault, key, row.id)) : row.text,
    at: row.at.toISOString(),
  }));
}

export async function startConversation(
  deps: ConversationDeps,
  programId: string,
  channel: 'web' | 'telegram',
  externalId?: string,
): Promise<{ conversation: ConversationRow; key: string | null }> {
  const program = await getProgram(deps.db, programId);
  if (!program) throw new Error(`program ${programId} does not exist`);
  const id = newId('cnv');
  const key = channel === 'web' ? randomBytes(24).toString('base64url') : null;
  const conversation = await deps.db
    .insertInto('conversation')
    .values({
      id,
      program_id: programId,
      channel,
      external_id: externalId ?? id,
      secret_hash: key ? hash(key) : null,
      renter_id: null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await addLine(deps, conversation, 'bot', greeting(program), false);
  return { conversation, key };
}

/** The web conversation the key opens, on the portal's own program; any mismatch looks like no conversation at all. */
export async function conversationForKey(
  db: Kysely<Database>,
  programId: string,
  id: string,
  key: string | undefined,
): Promise<ConversationRow> {
  const row = await db
    .selectFrom('conversation')
    .selectAll()
    .where('id', '=', id)
    .where('program_id', '=', programId)
    .where('channel', '=', 'web')
    .executeTakeFirst();
  const stored = row?.secret_hash ? Buffer.from(row.secret_hash) : null;
  const given = key ? Buffer.from(hash(key)) : null;
  if (!row || !stored || !given || !timingSafeEqual(stored, given)) throw notFound(id);
  return row;
}

// A renter's line, and the bot's answer while the bot has the conversation. A closed conversation reopens with the bot;
// one waiting for or held by a person gets no bot answer, so nobody talks over the person.
export async function receive(
  deps: ConversationDeps,
  conversation: ConversationRow,
  text: string,
  renterId: string | null,
  personal: boolean,
): Promise<{ state: ConversationState; lines: Line[] }> {
  const renter = conversation.renter_id ?? renterId;
  const said = await addLine(deps, conversation, 'renter', text, personal);
  const lines = [asLine(said)];
  let state: ConversationState = conversation.state === 'closed' ? 'bot' : conversation.state;
  let context = conversation.context;
  const who = {
    programId: conversation.program_id,
    renterId: renter,
    channel: conversation.channel,
  };
  if (state === 'bot') {
    const turn = await botTurn(deps, who, text, said.protectedText);
    lines.push(asLine(await addLine(deps, conversation, 'bot', turn.reply, personal)));
    if (turn.handover) {
      state = 'waiting';
      context = { ...context, ...turn.handover.context, handedOverAt: deps.clock().toISOString() };
    }
  } else if (state === 'waiting') {
    // Nobody talks over the person who is coming, but a policy number sent now is checked and added to the case.
    const note = await policyNote(deps.db, who, text);
    if (note) {
      lines.push(asLine(await addLine(deps, conversation, 'bot', note.reply, personal)));
      if (note.policy) context = { ...context, policy: note.policy };
    }
  }
  await deps.db
    .updateTable('conversation')
    .set({ state, context: JSON.stringify(context), renter_id: renter, updated_at: deps.clock() })
    .where('id', '=', conversation.id)
    .execute();
  return { state, lines };
}

export async function conversationById(db: Kysely<Database>, id: string): Promise<ConversationRow> {
  const row = await db
    .selectFrom('conversation')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) throw notFound(id);
  return row;
}

function assertStaffOwns(p: Principal, row: ConversationRow): void {
  if (p.programId !== null && p.programId !== row.program_id) throw notFound(row.id);
}

// A person answers: the conversation is theirs from now on. On Telegram the line is sent first, so a line that could not
// be delivered is not shown as said.
export async function replyAsStaff(
  deps: ConversationDeps,
  p: Principal,
  id: string,
  text: string,
): Promise<Line> {
  const conversation = await conversationById(deps.db, id);
  assertStaffOwns(p, conversation);
  if (conversation.channel === 'telegram') {
    if (!deps.telegram) {
      throw new HttpError(503, 'channel_unavailable', 'Telegram is not connected on this server');
    }
    await deps.telegram.send(conversation.external_id, text);
  }
  const line = await addLine(deps, conversation, 'staff', text, canReadPersonal(p));
  await deps.db
    .updateTable('conversation')
    .set({ state: 'human', updated_at: deps.clock() })
    .where('id', '=', id)
    .execute();
  return asLine(line);
}

export async function setState(
  db: Kysely<Database>,
  p: Principal,
  id: string,
  to: 'bot' | 'human' | 'closed',
  now: Date,
): Promise<{ id: string; state: ConversationState }> {
  const conversation = await conversationById(db, id);
  assertStaffOwns(p, conversation);
  await db
    .updateTable('conversation')
    .set({ state: to, updated_at: now })
    .where('id', '=', id)
    .execute();
  return { id, state: to };
}
