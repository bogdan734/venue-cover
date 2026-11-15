import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../../db/types.js';
import { HttpError } from '../../http/errors.js';
import { principalOf } from './guard.js';

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

export function fingerprint(method: string, url: string, body: unknown): string {
  return createHash('sha256')
    .update(`${method} ${url}\n${canonicalJson(body ?? null)}`)
    .digest('hex');
}

// Runs `run` once per (principal, key). The key row and the work commit together, so a failed run leaves no trace
// and a concurrent request with the same key waits for the first one, then replays its stored response.
export async function withIdempotency<T extends object>(
  db: Kysely<Database>,
  principalId: string,
  key: string,
  requestHash: string,
  run: (trx: Transaction<Database>) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (trx) => {
    const inserted = await trx
      .insertInto('idempotency_key')
      .values({ principal_id: principalId, key, request_hash: requestHash, response: null })
      .onConflict((oc) => oc.columns(['principal_id', 'key']).doNothing())
      .returning('key')
      .executeTakeFirst();

    if (!inserted) {
      const existing = await trx
        .selectFrom('idempotency_key')
        .select(['request_hash', 'response'])
        .where('principal_id', '=', principalId)
        .where('key', '=', key)
        .executeTakeFirstOrThrow();
      if (existing.request_hash !== requestHash) {
        throw new HttpError(
          409,
          'idempotency_key_reused',
          'this Idempotency-Key was used with a different request',
        );
      }
      if (existing.response === null) throw new Error('idempotency row without a stored response');
      return existing.response as T;
    }

    const result = await run(trx);
    await trx
      .updateTable('idempotency_key')
      .set({ response: JSON.stringify(result) })
      .where('principal_id', '=', principalId)
      .where('key', '=', key)
      .execute();
    return result;
  });
}

// HTTP wrapper for state-changing routes: needs the Idempotency-Key header and the requireAuth guard.
export async function idempotent<T extends object>(
  db: Kysely<Database>,
  request: FastifyRequest,
  run: (trx: Transaction<Database>) => Promise<T>,
): Promise<T> {
  const key = request.headers['idempotency-key'];
  if (typeof key !== 'string' || key.length === 0 || key.length > 200) {
    throw new HttpError(
      400,
      'idempotency_key_required',
      'send an Idempotency-Key header (1 to 200 characters)',
    );
  }
  const hash = fingerprint(request.method, request.url, request.body);
  return withIdempotency(db, principalOf(request).keyId, key, hash, run);
}
