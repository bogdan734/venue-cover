import type { Kysely } from 'kysely';
import type { Database } from '../../db/types.js';
import { newId } from '../../domain/ids.js';

export interface AuditEntry {
  id: string;
  at: string;
  /** The name of the API key that made the change. */
  actor: string;
  action: string;
  detail: unknown;
}

export async function recordAudit(
  db: Kysely<Database>,
  entry: { keyId: string; programId: string | null; action: string; detail: object },
): Promise<void> {
  await db
    .insertInto('audit_log')
    .values({
      id: newId('aud'),
      key_id: entry.keyId,
      program_id: entry.programId,
      action: entry.action,
      detail: JSON.stringify(entry.detail),
    })
    .execute();
}

// Newest first.
export async function auditOf(
  db: Kysely<Database>,
  programId: string,
  limit = 100,
): Promise<AuditEntry[]> {
  const rows = await db
    .selectFrom('audit_log')
    .leftJoin('api_key', 'api_key.id', 'audit_log.key_id')
    .select([
      'audit_log.id',
      'audit_log.at',
      'audit_log.key_id',
      'audit_log.action',
      'audit_log.detail',
      'api_key.name',
    ])
    .where('audit_log.program_id', '=', programId)
    .orderBy('audit_log.at', 'desc')
    .orderBy('audit_log.id', 'desc')
    .limit(limit)
    .execute();
  return rows.map((r) => ({
    id: r.id,
    at: r.at.toISOString(),
    actor: r.name ?? r.key_id,
    action: r.action,
    detail: r.detail,
  }));
}
