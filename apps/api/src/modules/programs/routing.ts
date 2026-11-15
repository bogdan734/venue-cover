import type { Kysely } from 'kysely';
import type { Database } from '../../db/types.js';
import type { Contact } from '../../domain/types.js';

export interface Routing {
  venue: (Contact & { id: string }) | null;
  broker: Contact | null;
  routed: boolean;
}

// A booking reference from the venue's booking system identifies the rental, and with it the venue and broker that
// must receive a certificate. A missing or unknown number routes nowhere: only the insured gets a certificate.
export async function resolveRouting(
  db: Kysely<Database>,
  programId: string,
  bookingRef: string | null,
): Promise<Routing> {
  const none: Routing = { venue: null, broker: null, routed: false };
  if (!bookingRef) return none;
  const rental = await db
    .selectFrom('rental')
    .innerJoin('venue', 'venue.id', 'rental.venue_id')
    .select(['venue.id', 'venue.name', 'venue.contact_email'])
    .where('rental.program_id', '=', programId)
    .where('rental.ref', '=', bookingRef)
    .executeTakeFirst();
  if (!rental) return none;
  const broker = await db
    .selectFrom('program')
    .innerJoin('broker', 'broker.id', 'program.broker_id')
    .select(['broker.name', 'broker.email'])
    .where('program.id', '=', programId)
    .executeTakeFirstOrThrow();
  return {
    venue: { id: rental.id, name: rental.name, email: rental.contact_email },
    broker: { name: broker.name, email: broker.email },
    routed: true,
  };
}

export async function getVenue(
  db: Kysely<Database>,
  id: string,
): Promise<{ id: string; name: string } | undefined> {
  return db.selectFrom('venue').select(['id', 'name']).where('id', '=', id).executeTakeFirst();
}
