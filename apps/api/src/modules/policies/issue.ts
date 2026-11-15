import type { Transaction } from 'kysely';
import type { Database } from '../../db/types.js';
import { newId } from '../../domain/ids.js';
import type { Cents, PolicySnapshot } from '../../domain/types.js';
import { appendEvent } from '../events/index.js';

export interface PolicyToIssue {
  quoteId: string;
  programId: string;
  programCode: string;
  totalCents: Cents;
  startsAt: Date;
  endsAt: Date;
  snapshot: PolicySnapshot;
}

// Numbers come from a per-program counter row, so concurrent issues serialize on it and never repeat or skip
// (a rolled-back issue rolls the counter back too).
export async function issuePolicy(
  trx: Transaction<Database>,
  policy: PolicyToIssue,
): Promise<{ policyId: string; policyNumber: string }> {
  const counter = await trx
    .insertInto('policy_counter')
    .values({ program_id: policy.programId, last_number: 1 })
    .onConflict((oc) =>
      oc
        .column('program_id')
        .doUpdateSet((eb) => ({ last_number: eb('policy_counter.last_number', '+', 1) })),
    )
    .returning('last_number')
    .executeTakeFirstOrThrow();

  const policyId = newId('pol');
  const policyNumber = `${policy.programCode}-${String(counter.last_number).padStart(6, '0')}`;
  await trx
    .insertInto('policy')
    .values({
      id: policyId,
      quote_id: policy.quoteId,
      program_id: policy.programId,
      policy_number: policyNumber,
      starts_at: policy.startsAt,
      ends_at: policy.endsAt,
      total_cents: policy.totalCents,
      snapshot: JSON.stringify(policy.snapshot),
    })
    .execute();
  await appendEvent(trx, {
    type: 'policy.issued',
    programId: policy.programId,
    data: { policyId, policyNumber, quoteId: policy.quoteId, totalCents: policy.totalCents },
  });
  return { policyId, policyNumber };
}
