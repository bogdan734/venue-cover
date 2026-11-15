import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../../db/types.js';
import type { ProgramRules, ProgramTerms, ProvinceCode } from '../../domain/types.js';
import { HttpError } from '../../http/errors.js';
import type { Principal } from '../auth/index.js';
import { getActivities } from '../catalogue/index.js';
import { appendEvent } from '../events/index.js';
import {
  assertOwns,
  brokerExists,
  getProgram,
  getProgramRules,
  insertProgram,
  latestEffectiveFrom,
  listRuleVersions,
  type ProgramRulesChangeSet,
  type ProgramView,
  publishRules,
  resolveRules,
} from '../programs/index.js';
import { recordAudit } from '../tenants/index.js';
import { TEMPLATES } from './templates.js';

export interface ProgramDetail extends ProgramView {
  /** The rules in force today. */
  rules: ProgramRules;
  versions: { version: number; effectiveFrom: string }[];
}

export interface ProgramInput {
  templateId: string;
  name: string;
  code: string;
  province: ProvinceCode;
  brokerId: string;
  terms?: Partial<ProgramTerms>;
  rules?: ProgramRulesChangeSet;
}

const dayOf = (now: Date) => now.toISOString().slice(0, 10);

async function assertActivitiesExist(db: Kysely<Database>, ids: string[]): Promise<void> {
  const found = await getActivities(db, ids);
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0)
    throw new HttpError(400, 'unknown_activity', `no such activity: ${missing.join(', ')}`);
}

export async function getProgramDetail(
  db: Kysely<Database>,
  p: Principal,
  programId: string,
  now: Date,
): Promise<ProgramDetail> {
  assertOwns(p, programId);
  const program = await getProgram(db, programId);
  if (!program) throw new HttpError(404, 'program_not_found', `no program ${programId}`);
  return {
    ...program,
    rules: await getProgramRules(db, programId, dayOf(now)),
    versions: await listRuleVersions(db, programId),
  };
}

// A new client in one call: the template's terms and rules, with the overrides laid over them, effective today. It
// starts as a draft, which only staff can see.
export async function createProgramFromTemplate(
  trx: Transaction<Database>,
  p: Principal,
  input: ProgramInput,
  now: Date,
): Promise<ProgramDetail> {
  const template = TEMPLATES[input.templateId];
  if (!template) throw new HttpError(400, 'unknown_template', `no template ${input.templateId}`);
  if (!(await brokerExists(trx, input.brokerId))) {
    throw new HttpError(400, 'unknown_broker', `no broker ${input.brokerId}`);
  }
  const terms = { ...template.terms, ...input.terms };
  if (terms.commissionBps > terms.loadingBps) {
    throw new HttpError(
      400,
      'invalid_terms',
      'the commission cannot be larger than the loading it comes out of',
    );
  }
  const rules = resolveRules(template.rules, input.rules ?? {});
  await assertActivitiesExist(trx, rules.excludedActivityIds);

  const id = await insertProgram(trx, {
    code: input.code,
    name: input.name,
    province: input.province,
    brokerId: input.brokerId,
    terms,
    status: 'draft',
  });
  await publishRules(trx, id, rules, dayOf(now));
  await recordAudit(trx, {
    keyId: p.keyId,
    programId: id,
    action: 'program.created',
    detail: { code: input.code, name: input.name, templateId: input.templateId },
  });
  return getProgramDetail(trx, p, id, now);
}

// Publishes the rules that result from the changes, from the given date. Versions go in date order: a change cannot
// slip in before one that is already scheduled, because the later version was built without it.
export async function publishChanges(
  trx: Transaction<Database>,
  p: Principal,
  programId: string,
  changes: ProgramRulesChangeSet,
  effectiveFrom: string,
  now: Date,
): Promise<{ version: number; effectiveFrom: string; rules: ProgramRules }> {
  assertOwns(p, programId);
  if (!(await getProgram(trx, programId)))
    throw new HttpError(404, 'program_not_found', `no program ${programId}`);
  if (effectiveFrom < dayOf(now)) {
    throw new HttpError(400, 'effective_date_in_the_past', 'rules cannot take effect in the past');
  }
  const latest = await latestEffectiveFrom(trx, programId);
  if (latest && effectiveFrom < latest) {
    throw new HttpError(409, 'newer_rules_scheduled', `rules are already scheduled from ${latest}`);
  }
  const rules = resolveRules(await getProgramRules(trx, programId, effectiveFrom), changes);
  await assertActivitiesExist(trx, rules.excludedActivityIds);
  const { version } = await publishRules(trx, programId, rules, effectiveFrom);
  await appendEvent(trx, {
    type: 'program.rules_published',
    programId,
    data: { programId, version, effectiveFrom },
  });
  await recordAudit(trx, {
    keyId: p.keyId,
    programId,
    action: 'rules.published',
    detail: { version, effectiveFrom, changes },
  });
  return { version, effectiveFrom, rules };
}
