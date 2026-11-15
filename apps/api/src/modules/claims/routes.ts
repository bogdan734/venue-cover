import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from '../../db/types.js';
import { idempotent, principalOf, requireAuth } from '../auth/index.js';
import { ClaimNotice, getClaimFor, reportClaim } from './service.js';

export function registerClaimRoutes(app: FastifyInstance, db: Kysely<Database>): void {
  app.post(
    '/v1/claims',
    { preHandler: requireAuth(db, 'quotes:write') },
    async (request, reply) => {
      const notice = ClaimNotice.parse(request.body);
      const result = await idempotent(db, request, (trx) =>
        reportClaim(trx, principalOf(request), notice),
      );
      return reply.status(201).send(result);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/v1/claims/:id',
    { preHandler: requireAuth(db, 'quotes:read') },
    async (request) => getClaimFor(db, principalOf(request), request.params.id),
  );
}
