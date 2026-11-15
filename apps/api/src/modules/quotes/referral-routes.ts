import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { idempotent, principalOf, requireAuth } from '../auth/index.js';
import type { Shield } from '../privacy/index.js';
import { claimReferral, decideReferral, getReferral, listReferrals } from './review.js';
import type { QuoteRouteDeps } from './routes.js';
import { UnderwriterDecision } from './schema.js';
import { getWorksheet } from './worksheet.js';

const ListQuery = z.object({ state: z.enum(['open', 'claimed', 'decided']).optional() });

export function registerReferralRoutes(
  app: FastifyInstance,
  { db, clock, shield }: Pick<QuoteRouteDeps, 'db' | 'clock'> & { shield: Shield },
): void {
  const guard = requireAuth(db, 'referrals:decide');

  // Open and claimed referrals by default, the earliest deadline first.
  app.get('/v1/referrals', { preHandler: guard }, async (request) => {
    const { state } = ListQuery.parse(request.query);
    const referrals = await listReferrals(
      db,
      principalOf(request),
      clock(),
      state ? [state] : ['open', 'claimed'],
    );
    return { referrals };
  });

  app.get<{ Params: { id: string } }>('/v1/referrals/:id', { preHandler: guard }, async (request) =>
    getReferral(db, principalOf(request), request.params.id, clock(), shield),
  );

  app.get<{ Params: { id: string } }>(
    '/v1/referrals/:id/worksheet',
    { preHandler: guard },
    async (request) => getWorksheet(db, principalOf(request), request.params.id),
  );

  // Claiming is naturally repeatable, so it takes no Idempotency-Key.
  app.post<{ Params: { id: string } }>(
    '/v1/referrals/:id/claim',
    { preHandler: guard },
    async (request) =>
      db
        .transaction()
        .execute((trx) => claimReferral(trx, principalOf(request), request.params.id, clock())),
  );

  app.post<{ Params: { id: string } }>(
    '/v1/referrals/:id/decision',
    { preHandler: guard },
    async (request) => {
      const decision = UnderwriterDecision.parse(request.body);
      return idempotent(db, request, (trx) =>
        decideReferral(trx, principalOf(request), request.params.id, decision, clock()),
      );
    },
  );
}
