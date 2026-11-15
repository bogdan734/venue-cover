import type { Kysely } from 'kysely';
import type { Database } from '../../db/types.js';

// One more visitor to a program's portal on a day ('YYYY-MM-DD'). Counting each visitor once is the caller's part:
// the portal sends one Idempotency-Key per visitor and day, so a repeat is answered without counting.
export async function countVisit(
  db: Kysely<Database>,
  programId: string,
  day: string,
): Promise<void> {
  await db
    .insertInto('portal_visit')
    .values({ program_id: programId, day, visitors: 1 })
    .onConflict((oc) =>
      oc
        .columns(['program_id', 'day'])
        .doUpdateSet((eb) => ({ visitors: eb('portal_visit.visitors', '+', 1) })),
    )
    .execute();
}
