import { sql } from 'kysely';
import type { ConversationState } from '../../domain/types.js';
import { HttpError } from '../../http/errors.js';
import type { Principal } from '../auth/index.js';
import { open, reveal } from '../privacy/index.js';
import {
  type ConversationDeps,
  canReadPersonal,
  conversationById,
  type Line,
  linesOf,
} from './service.js';

export interface InboxItem {
  id: string;
  program: { id: string; code: string; name: string };
  channel: 'web' | 'telegram';
  state: ConversationState;
  reason: string | null;
  signedIn: boolean;
  updatedAt: string;
  last: { sender: Line['sender']; text: string } | null;
  lines: number;
}

// Waiting for a person first, then held by one, then the rest; newest first within each.
const ORDER = sql<number>`case conversation.state when 'waiting' then 0 when 'human' then 1 when 'bot' then 2 else 3 end`;

export async function inbox(
  deps: ConversationDeps,
  p: Principal,
  limit = 100,
): Promise<InboxItem[]> {
  let query = deps.db
    .selectFrom('conversation')
    .innerJoin('program', 'program.id', 'conversation.program_id')
    .select([
      'conversation.id',
      'conversation.program_id',
      'conversation.channel',
      'conversation.state',
      'conversation.context',
      'conversation.renter_id',
      'conversation.updated_at',
      'program.code',
      'program.name',
    ])
    .select((eb) => [
      eb
        .selectFrom('message')
        .select(eb.fn.countAll<string>().as('n'))
        .whereRef('message.conversation_id', '=', 'conversation.id')
        .as('lines'),
    ]);
  if (p.programId !== null) query = query.where('conversation.program_id', '=', p.programId);
  const rows = await query
    .orderBy(ORDER)
    .orderBy('conversation.updated_at', 'desc')
    .limit(limit)
    .execute();

  const lasts = rows.length
    ? await deps.db
        .selectFrom('message')
        .distinctOn('conversation_id')
        .selectAll()
        .where(
          'conversation_id',
          'in',
          rows.map((r) => r.id),
        )
        .orderBy('conversation_id')
        .orderBy('at', 'desc')
        .execute()
    : [];
  const lastOf = new Map(lasts.map((m) => [m.conversation_id, m]));
  const personal = canReadPersonal(p);

  return rows.map((row) => {
    const last = lastOf.get(row.id);
    const text =
      last && personal && last.vault
        ? reveal(last.text, open(last.vault, deps.shield.keys(row.program_id).seal, last.id))
        : last?.text;
    return {
      id: row.id,
      program: { id: row.program_id, code: row.code, name: row.name },
      channel: row.channel,
      state: row.state,
      reason: typeof row.context.reason === 'string' ? row.context.reason : null,
      signedIn: row.renter_id !== null,
      updatedAt: row.updated_at.toISOString(),
      last: last && text !== undefined ? { sender: last.sender, text } : null,
      lines: Number(row.lines ?? 0),
    };
  });
}

// One conversation with everything a person needs to pick it up: the lines, why it was handed over, and the policy.
export async function inboxDetail(deps: ConversationDeps, p: Principal, id: string) {
  const conversation = await conversationById(deps.db, id);
  if (p.programId !== null && p.programId !== conversation.program_id) {
    throw new HttpError(404, 'conversation_not_found', `no conversation ${id}`);
  }
  const program = await deps.db
    .selectFrom('program')
    .select(['id', 'code', 'name'])
    .where('id', '=', conversation.program_id)
    .executeTakeFirstOrThrow();
  return {
    id: conversation.id,
    program,
    channel: conversation.channel,
    state: conversation.state,
    signedIn: conversation.renter_id !== null,
    context: conversation.context,
    createdAt: conversation.created_at.toISOString(),
    messages: await linesOf(deps, conversation, canReadPersonal(p)),
  };
}
