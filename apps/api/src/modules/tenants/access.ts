import { createHash, randomBytes } from 'node:crypto';
import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../../db/types.js';
import { newId } from '../../domain/ids.js';
import { HttpError } from '../../http/errors.js';
import type { Principal } from '../auth/index.js';
import { getProgram } from '../programs/index.js';
import { recordAudit } from './audit.js';

export interface AccessLink {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

// Handing out, listing and revoking client links is the operator's work; a program's own key does none of it.
function assertOperator(p: Principal): void {
  if (p.programId !== null) {
    throw new HttpError(403, 'forbidden', 'client links are managed with a key without a program');
  }
}

export async function createAccess(
  trx: Transaction<Database>,
  p: Principal,
  programId: string,
  label: string,
): Promise<AccessLink & { token: string }> {
  assertOperator(p);
  if (!(await getProgram(trx, programId))) {
    throw new HttpError(404, 'program_not_found', `no program ${programId}`);
  }
  const token = `ca_${randomBytes(24).toString('base64url')}`;
  const row = await trx
    .insertInto('program_access')
    .values({ id: newId('acc'), program_id: programId, token_hash: hash(token), label })
    .returningAll()
    .executeTakeFirstOrThrow();
  await recordAudit(trx, {
    keyId: p.keyId,
    programId,
    action: 'access.created',
    detail: { accessId: row.id, label },
  });
  return {
    id: row.id,
    label,
    createdAt: row.created_at.toISOString(),
    lastUsedAt: null,
    revokedAt: null,
    token,
  };
}

export async function listAccess(
  db: Kysely<Database>,
  p: Principal,
  programId: string,
): Promise<AccessLink[]> {
  assertOperator(p);
  const rows = await db
    .selectFrom('program_access')
    .selectAll()
    .where('program_id', '=', programId)
    .orderBy('created_at', 'desc')
    .execute();
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    createdAt: r.created_at.toISOString(),
    lastUsedAt: r.last_used_at?.toISOString() ?? null,
    revokedAt: r.revoked_at?.toISOString() ?? null,
  }));
}

export async function revokeAccess(
  trx: Transaction<Database>,
  p: Principal,
  programId: string,
  accessId: string,
  now: Date,
): Promise<{ id: string; revokedAt: string }> {
  assertOperator(p);
  const row = await trx
    .updateTable('program_access')
    .set({ revoked_at: now })
    .where('id', '=', accessId)
    .where('program_id', '=', programId)
    .returning(['id'])
    .executeTakeFirst();
  if (!row) throw new HttpError(404, 'access_not_found', `no client link ${accessId}`);
  await recordAudit(trx, {
    keyId: p.keyId,
    programId,
    action: 'access.revoked',
    detail: { accessId },
  });
  return { id: row.id, revokedAt: now.toISOString() };
}

// Which program a link opens, asked on every visit, so a revoked link stops at once. An unknown and a revoked link look
// the same.
export async function resolveAccess(
  db: Kysely<Database>,
  p: Principal,
  token: string,
  now: Date,
): Promise<{ accessId: string; programId: string; code: string; label: string }> {
  assertOperator(p);
  const row = await db
    .updateTable('program_access')
    .set({ last_used_at: now })
    .from('program')
    .whereRef('program.id', '=', 'program_access.program_id')
    .where('program_access.token_hash', '=', hash(token))
    .where('program_access.revoked_at', 'is', null)
    .returning([
      'program_access.id',
      'program_access.program_id',
      'program_access.label',
      'program.code',
    ])
    .executeTakeFirst();
  if (!row)
    throw new HttpError(404, 'access_not_found', 'this client link is unknown or was turned off');
  return { accessId: row.id, programId: row.program_id, code: row.code, label: row.label };
}
