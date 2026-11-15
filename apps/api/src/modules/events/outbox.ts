import { randomUUID } from 'node:crypto';
import type { Kysely, Selectable, Transaction } from 'kysely';
import type { Database } from '../../db/types.js';
import type { EventType } from '../../domain/types.js';

export interface DomainEvent {
  id: string;
  type: EventType;
  programId: string;
  occurredAt: string;
  data: unknown;
}

type OutboxRow = Selectable<Database['outbox_event']>;

export function toDomainEvent(row: OutboxRow): DomainEvent {
  return {
    id: row.event_id,
    type: row.type as EventType,
    programId: row.program_id,
    occurredAt: row.occurred_at.toISOString(),
    data: row.data,
  };
}

// Call inside the transaction that changes state: the event commits or rolls back together with that change.
export async function appendEvent(
  trx: Transaction<Database>,
  input: { type: EventType; programId: string; data: unknown },
): Promise<DomainEvent> {
  const event: DomainEvent = { id: randomUUID(), occurredAt: new Date().toISOString(), ...input };
  await trx
    .insertInto('outbox_event')
    .values({
      event_id: event.id,
      type: event.type,
      program_id: event.programId,
      occurred_at: new Date(event.occurredAt),
      data: JSON.stringify(event.data),
    })
    .execute();
  return event;
}

export async function getEvent(
  db: Kysely<Database>,
  eventId: string,
): Promise<DomainEvent | undefined> {
  const row = await db
    .selectFrom('outbox_event')
    .selectAll()
    .where('event_id', '=', eventId)
    .executeTakeFirst();
  return row ? toDomainEvent(row) : undefined;
}

export async function getEventTypes(
  db: Kysely<Database>,
  eventIds: string[],
): Promise<Map<string, EventType>> {
  if (eventIds.length === 0) return new Map();
  const rows = await db
    .selectFrom('outbox_event')
    .select(['event_id', 'type'])
    .where('event_id', 'in', eventIds)
    .execute();
  return new Map(rows.map((r) => [r.event_id, r.type as EventType]));
}

export interface StreamedEvent {
  seq: number;
  event: DomainEvent;
}

export async function latestSeq(db: Kysely<Database>): Promise<number> {
  const row = await db
    .selectFrom('outbox_event')
    .select((eb) => eb.fn.max('seq').as('seq'))
    .executeTakeFirst();
  return row?.seq ?? 0;
}

// Events after a sequence number, oldest first; a program id limits them to one program. Used by the live stream.
export async function eventsSince(
  db: Kysely<Database>,
  afterSeq: number,
  programId: string | null,
  limit: number,
): Promise<StreamedEvent[]> {
  let query = db.selectFrom('outbox_event').selectAll().where('seq', '>', afterSeq);
  if (programId) query = query.where('program_id', '=', programId);
  const rows = await query.orderBy('seq').limit(limit).execute();
  return rows.map((row) => ({ seq: row.seq, event: toDomainEvent(row) }));
}
