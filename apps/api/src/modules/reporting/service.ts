import type { Kysely } from 'kysely';
import type { Database } from '../../db/types.js';
import { HttpError } from '../../http/errors.js';
import type { Principal } from '../auth/index.js';
import { listPoliciesIssued } from '../policies/index.js';
import { listProgramsWithBroker } from '../programs/index.js';
import { buildPolicyReport, monthRange, type PolicyReport } from './policy-report.js';

// A key bound to a program sees that program; a key without one may name a program, or take them all.
export async function policyReportFor(
  db: Kysely<Database>,
  principal: Principal,
  month: string,
  requested: string | undefined,
): Promise<PolicyReport> {
  if (
    principal.programId !== null &&
    requested !== undefined &&
    requested !== principal.programId
  ) {
    throw new HttpError(404, 'program_not_found', `no program ${requested}`);
  }
  const programId = principal.programId ?? requested;
  const [program] = await listProgramsWithBroker(db, programId);
  if (programId !== undefined && !program) {
    throw new HttpError(404, 'program_not_found', `no program ${programId}`);
  }
  const policies = await listPoliciesIssued(db, monthRange(month), programId);
  return buildPolicyReport(
    month,
    programId && program ? { id: program.id, code: program.code, name: program.name } : null,
    policies,
  );
}
