import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { Database } from '../db/types.js';
import { principalOf, requireAuth } from '../modules/auth/index.js';

const Query = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });

// Every request made with a key is written down after its answer has gone, so logging never slows an answer. The route
// template is kept, not the address: ids and query strings can carry personal details.
export function registerRequestLog(app: FastifyInstance, db: Kysely<Database>): void {
  app.addHook('onResponse', async (request, reply) => {
    const principal = request.principal;
    if (!principal) return;
    try {
      await db
        .insertInto('request_log')
        .values({
          key_id: principal.keyId,
          program_id: principal.programId,
          method: request.method,
          route: request.routeOptions.url ?? 'unknown',
          status: reply.statusCode,
          ms: Math.round(reply.elapsedTime),
        })
        .execute();
    } catch (error) {
      console.error('could not log a request:', error instanceof Error ? error.message : error);
    }
  });

  // A program's keys read their program's requests; a key without a program reads all of them.
  app.get('/v1/request-log', { preHandler: requireAuth(db) }, async (request) => {
    const { limit } = Query.parse(request.query);
    const { programId } = principalOf(request);
    let query = db
      .selectFrom('request_log')
      .leftJoin('api_key', 'api_key.id', 'request_log.key_id')
      .select([
        'request_log.at',
        'request_log.method',
        'request_log.route',
        'request_log.status',
        'request_log.ms',
        'request_log.program_id',
        'api_key.name',
      ]);
    if (programId !== null) query = query.where('request_log.program_id', '=', programId);
    const rows = await query.orderBy('request_log.id', 'desc').limit(limit).execute();
    return {
      requests: rows.map((r) => ({
        at: r.at.toISOString(),
        key: r.name ?? 'removed key',
        programId: r.program_id,
        method: r.method,
        route: r.route,
        status: r.status,
        ms: r.ms,
      })),
    };
  });
}
