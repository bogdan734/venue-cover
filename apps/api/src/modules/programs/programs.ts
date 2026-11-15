import type { Kysely, Selectable, Transaction } from 'kysely';
import type { Database } from '../../db/types.js';
import { newId } from '../../domain/ids.js';
import type {
  Contacts,
  ProgramRules,
  ProgramStatus,
  ProgramTerms,
  ProvinceCode,
  Theme,
} from '../../domain/types.js';
import { HttpError } from '../../http/errors.js';
import type { Principal } from '../auth/index.js';
import { parseRules } from './rules.js';

export interface ProgramView {
  id: string;
  code: string;
  name: string;
  province: ProvinceCode;
  brokerId: string;
  terms: ProgramTerms;
  status: ProgramStatus;
  theme: Theme | null;
  contacts: Contacts | null;
}

export type NewProgram = Omit<ProgramView, 'id' | 'status' | 'theme' | 'contacts'> & {
  status: ProgramStatus;
};

// A program the key may not touch looks exactly like one that does not exist.
export function assertOwns(p: Principal, programId: string): void {
  if (p.programId !== null && p.programId !== programId) {
    throw new HttpError(404, 'program_not_found', `no program ${programId}`);
  }
}

function toView(row: Selectable<Database['program']>): ProgramView {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    province: row.province,
    brokerId: row.broker_id,
    terms: {
      loadingBps: row.loading_bps,
      commissionBps: row.commission_bps,
      feeCents: row.fee_cents,
    },
    status: row.status,
    theme: row.theme,
    contacts: row.contacts,
  };
}

export async function getProgram(
  db: Kysely<Database>,
  id: string,
): Promise<ProgramView | undefined> {
  const row = await db.selectFrom('program').selectAll().where('id', '=', id).executeTakeFirst();
  return row ? toView(row) : undefined;
}

export async function venueBelongsToProgram(
  db: Kysely<Database>,
  venueId: string,
  programId: string,
): Promise<boolean> {
  const row = await db
    .selectFrom('venue')
    .select('id')
    .where('id', '=', venueId)
    .where('program_id', '=', programId)
    .executeTakeFirst();
  return row !== undefined;
}

export async function brokerExists(db: Kysely<Database>, id: string): Promise<boolean> {
  return (
    (await db.selectFrom('broker').select('id').where('id', '=', id).executeTakeFirst()) !==
    undefined
  );
}

// The rules version with the latest effective date that is not after `onDate` ('YYYY-MM-DD').
export async function getProgramRules(
  db: Kysely<Database>,
  programId: string,
  onDate: string,
): Promise<ProgramRules> {
  const row = await db
    .selectFrom('program_rules')
    .select('rules')
    .where('program_id', '=', programId)
    .where('effective_from', '<=', onDate)
    .orderBy('effective_from', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (!row) throw new Error(`program ${programId} has no rules in force on ${onDate}`);
  return parseRules(row.rules);
}

export async function listRuleVersions(
  db: Kysely<Database>,
  programId: string,
): Promise<{ version: number; effectiveFrom: string }[]> {
  const rows = await db
    .selectFrom('program_rules')
    .select(['version', 'effective_from'])
    .where('program_id', '=', programId)
    .orderBy('version')
    .execute();
  return rows.map((r) => ({ version: r.version, effectiveFrom: r.effective_from }));
}

export async function insertProgram(
  trx: Transaction<Database>,
  program: NewProgram,
): Promise<string> {
  const id = newId('prg');
  try {
    await trx
      .insertInto('program')
      .values({
        id,
        code: program.code,
        name: program.name,
        province: program.province,
        broker_id: program.brokerId,
        loading_bps: program.terms.loadingBps,
        commission_bps: program.terms.commissionBps,
        fee_cents: program.terms.feeCents,
        status: program.status,
      })
      .execute();
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new HttpError(409, 'code_taken', `the program code ${program.code} is already in use`);
    }
    throw error;
  }
  return id;
}

// Adds the next version of a program's rules, effective from the given date. Nothing is ever updated in place.
export async function publishRules(
  trx: Transaction<Database>,
  programId: string,
  rules: ProgramRules,
  effectiveFrom: string,
): Promise<{ version: number }> {
  const last = await trx
    .selectFrom('program_rules')
    .select((eb) => eb.fn.max('version').as('version'))
    .where('program_id', '=', programId)
    .executeTakeFirst();
  const version = (last?.version ?? 0) + 1;
  try {
    await trx
      .insertInto('program_rules')
      .values({
        id: newId('rul'),
        program_id: programId,
        version,
        effective_from: effectiveFrom,
        rules: JSON.stringify(rules),
      })
      .execute();
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new HttpError(
        409,
        'rules_already_scheduled',
        `rules already take effect on ${effectiveFrom}`,
      );
    }
    throw error;
  }
  return { version };
}

export async function latestEffectiveFrom(
  db: Kysely<Database>,
  programId: string,
): Promise<string | undefined> {
  const row = await db
    .selectFrom('program_rules')
    .select((eb) => eb.fn.max('effective_from').as('latest'))
    .where('program_id', '=', programId)
    .executeTakeFirst();
  return row?.latest ?? undefined;
}

export async function getPrograms(
  db: Kysely<Database>,
  ids: string[],
): Promise<Map<string, ProgramView>> {
  const out = new Map<string, ProgramView>();
  if (ids.length === 0) return out;
  const rows = await db
    .selectFrom('program')
    .selectAll()
    .where('id', 'in', [...new Set(ids)])
    .execute();
  for (const row of rows) out.set(row.id, toView(row));
  return out;
}

export type ProgramWithBroker = ProgramView & { brokerName: string };

// Every program with its broker's name, by code; or just the one named.
export async function listProgramsWithBroker(
  db: Kysely<Database>,
  programId?: string,
): Promise<ProgramWithBroker[]> {
  let query = db
    .selectFrom('program')
    .innerJoin('broker', 'broker.id', 'program.broker_id')
    .selectAll('program')
    .select('broker.name as brokerName');
  if (programId) query = query.where('program.id', '=', programId);
  const rows = await query.orderBy('program.code').execute();
  return rows.map((row) => ({ ...toView(row), brokerName: row.brokerName }));
}

export async function listBrokers(db: Kysely<Database>): Promise<{ id: string; name: string }[]> {
  return db.selectFrom('broker').select(['id', 'name']).orderBy('name').execute();
}
