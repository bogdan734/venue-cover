import type { Kysely, Transaction } from 'kysely';
import { z } from 'zod';
import type { Database } from '../../db/types.js';
import { newId } from '../../domain/ids.js';
import { HttpError } from '../../http/errors.js';
import type { Principal } from '../auth/index.js';
import { appendEvent } from '../events/index.js';
import { getPolicyFor } from '../policies/index.js';

const isCalendarDate = (value: string): boolean => {
  const at = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().startsWith(value);
};

// A first notice of loss.
export const ClaimNotice = z.object({
  policyId: z.string().min(1),
  /** The day the loss happened, YYYY-MM-DD. */
  lossDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'a date is written YYYY-MM-DD')
    .refine(isCalendarDate, 'not a date on the calendar'),
  description: z.string().trim().min(10).max(5000),
  reporter: z.object({ name: z.string().trim().min(1).max(200), email: z.email().max(320) }),
});
export type ClaimNotice = z.infer<typeof ClaimNotice>;

export interface ClaimView {
  id: string;
  policyId: string;
  policyNumber: string;
  lossDate: string;
  description: string;
  reporter: { name: string; email: string };
  createdAt: string;
}

// The loss has to fall on a day the policy was in force. Policy times are the event's own clock, so their dates are
// the event's own days: an evening event that runs past midnight covers the next morning too.
export async function reportClaim(
  trx: Transaction<Database>,
  principal: Principal,
  input: ClaimNotice,
): Promise<{ claimId: string }> {
  const policy = await getPolicyFor(trx, principal, input.policyId);
  const first = policy.startsAt.slice(0, 10);
  const last = policy.endsAt.slice(0, 10);
  if (input.lossDate < first || input.lossDate > last) {
    throw new HttpError(
      422,
      'loss_outside_policy_period',
      `policy ${policy.policyNumber} covers ${first === last ? first : `${first} to ${last}`}, not ${input.lossDate}`,
    );
  }
  const claimId = newId('clm');
  await trx
    .insertInto('claim')
    .values({
      id: claimId,
      policy_id: policy.id,
      loss_date: input.lossDate,
      description: input.description,
      reporter: JSON.stringify(input.reporter),
    })
    .execute();
  // The event names the claim and the policy, not what happened or who told us: subscribers fetch the rest if they
  // are allowed to.
  await appendEvent(trx, {
    type: 'claim.reported',
    programId: policy.programId,
    data: {
      claimId,
      policyId: policy.id,
      policyNumber: policy.policyNumber,
      lossDate: input.lossDate,
    },
  });
  return { claimId };
}

// A program key sees its own program's claims; a key without a program sees all.
export async function getClaimFor(
  db: Kysely<Database>,
  principal: Principal,
  id: string,
): Promise<ClaimView> {
  const row = await db
    .selectFrom('claim')
    .innerJoin('policy', 'policy.id', 'claim.policy_id')
    .select([
      'claim.id',
      'claim.policy_id',
      'claim.loss_date',
      'claim.description',
      'claim.reporter',
      'claim.created_at',
      'policy.policy_number',
      'policy.program_id',
    ])
    .where('claim.id', '=', id)
    .executeTakeFirst();
  if (!row || (principal.programId !== null && principal.programId !== row.program_id)) {
    throw new HttpError(404, 'claim_not_found', `no claim ${id}`);
  }
  return {
    id: row.id,
    policyId: row.policy_id,
    policyNumber: row.policy_number,
    lossDate: row.loss_date,
    description: row.description,
    reporter: row.reporter as ClaimView['reporter'],
    createdAt: row.created_at.toISOString(),
  };
}
