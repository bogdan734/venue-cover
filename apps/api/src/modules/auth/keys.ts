import { createHash, randomBytes } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { Database } from '../../db/types.js';
import { newId } from '../../domain/ids.js';
import type { Scope } from '../../domain/types.js';

export interface Principal {
  keyId: string;
  programId: string | null;
  scopes: Scope[];
}

const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

// The plaintext key is returned once; only its SHA-256 is stored (the key is random, so no salt is needed).
export async function createApiKey(
  db: Kysely<Database>,
  input: { name: string; programId: string | null; scopes: Scope[] },
): Promise<{ id: string; key: string }> {
  const id = newId('key');
  const key = `vck_${randomBytes(24).toString('base64url')}`;
  await db
    .insertInto('api_key')
    .values({
      id,
      program_id: input.programId,
      name: input.name,
      key_hash: hashKey(key),
      scopes: input.scopes,
    })
    .execute();
  return { id, key };
}

export async function findPrincipal(db: Kysely<Database>, key: string): Promise<Principal | null> {
  const row = await db
    .selectFrom('api_key')
    .select(['id', 'program_id', 'scopes'])
    .where('key_hash', '=', hashKey(key))
    .where('revoked_at', 'is', null)
    .executeTakeFirst();
  return row ? { keyId: row.id, programId: row.program_id, scopes: row.scopes } : null;
}
