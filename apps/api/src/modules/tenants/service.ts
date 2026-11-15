import type { Transaction } from 'kysely';
import type { Database } from '../../db/types.js';
import type { Contacts, ProgramStatus, Theme } from '../../domain/types.js';
import { HttpError } from '../../http/errors.js';
import type { Principal } from '../auth/index.js';
import { assertOwns, getProgram, type ProgramView } from '../programs/index.js';
import { recordAudit } from './audit.js';
import { canMove } from './lifecycle.js';
import { problemsOf } from './theme.js';

async function lockProgram(trx: Transaction<Database>, p: Principal, programId: string) {
  assertOwns(p, programId);
  const row = await trx
    .selectFrom('program')
    .select(['status', 'theme', 'contacts'])
    .where('id', '=', programId)
    .forUpdate()
    .executeTakeFirst();
  if (!row) throw new HttpError(404, 'program_not_found', `no program ${programId}`);
  return row;
}

async function viewOf(trx: Transaction<Database>, programId: string): Promise<ProgramView> {
  const program = await getProgram(trx, programId);
  if (!program) throw new Error(`program ${programId} vanished inside its own transaction`);
  return program;
}

// The names of the fields that changed, for the log. Values stay out of it: a logo alone can be 100 kB.
function changed<T extends object>(before: T | null, after: T): string[] {
  return (Object.keys(after) as (keyof T)[])
    .filter((k) => before === null || before[k] !== after[k])
    .map(String);
}

export async function setAppearance(
  trx: Transaction<Database>,
  p: Principal,
  programId: string,
  theme: Theme,
): Promise<ProgramView> {
  const problems = problemsOf(theme);
  if (problems.length > 0) throw new HttpError(400, 'unreadable_theme', problems.join('; '));
  const row = await lockProgram(trx, p, programId);
  await trx
    .updateTable('program')
    .set({ theme: JSON.stringify(theme) })
    .where('id', '=', programId)
    .execute();
  await recordAudit(trx, {
    keyId: p.keyId,
    programId,
    action: 'appearance.changed',
    detail: { changed: changed(row.theme, theme) },
  });
  return viewOf(trx, programId);
}

export async function setContacts(
  trx: Transaction<Database>,
  p: Principal,
  programId: string,
  contacts: Contacts,
): Promise<ProgramView> {
  const row = await lockProgram(trx, p, programId);
  await trx
    .updateTable('program')
    .set({ contacts: JSON.stringify(contacts) })
    .where('id', '=', programId)
    .execute();
  await recordAudit(trx, {
    keyId: p.keyId,
    programId,
    action: 'contacts.changed',
    detail: { changed: changed(row.contacts, contacts) },
  });
  return viewOf(trx, programId);
}

// Opening, pausing and reopening a client is the operator's call, not the client's own key's.
export async function moveTo(
  trx: Transaction<Database>,
  p: Principal,
  programId: string,
  to: ProgramStatus,
): Promise<ProgramView> {
  if (p.programId !== null) {
    throw new HttpError(403, 'forbidden', 'only a key without a program can change its status');
  }
  const { status: from } = await lockProgram(trx, p, programId);
  if (!canMove(from, to)) {
    throw new HttpError(409, 'illegal_transition', `a ${from} program cannot become ${to}`);
  }
  await trx.updateTable('program').set({ status: to }).where('id', '=', programId).execute();
  await recordAudit(trx, {
    keyId: p.keyId,
    programId,
    action: 'status.changed',
    detail: { from, to },
  });
  return viewOf(trx, programId);
}
