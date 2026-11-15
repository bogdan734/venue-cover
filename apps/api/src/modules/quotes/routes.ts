import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from '../../db/types.js';
import { HttpError } from '../../http/errors.js';
import type { PaymentProvider } from '../../providers/payments.js';
import { renterOf, requireRenter } from '../accounts/index.js';
import { idempotent, principalOf, requireAuth } from '../auth/index.js';
import { getPoliciesByQuote } from '../policies/index.js';
import { resolveTags, type Shield } from '../privacy/index.js';
import { BindBody, QuoteBody } from './schema.js';
import { bindQuote, createQuote, getQuote, quotesOfRenter } from './service.js';

export interface QuoteRouteDeps {
  db: Kysely<Database>;
  payments: PaymentProvider;
  shield: Shield;
  clock: () => Date;
}

export function registerQuoteRoutes(
  app: FastifyInstance,
  { db, payments, shield, clock }: QuoteRouteDeps,
): void {
  app.post(
    '/v1/quotes',
    { preHandler: requireAuth(db, 'quotes:write') },
    async (request, reply) => {
      // An agent may hand back the tags it was given for a person; the quote is made with what they stand for.
      const programId = principalOf(request).programId;
      const input = QuoteBody.parse(await resolveTags(db, shield, programId, request.body));
      const renter = await renterOf(db, request, clock());
      const quote = await idempotent(db, request, (trx) =>
        createQuote(trx, principalOf(request), input, clock(), undefined, renter?.id ?? null),
      );
      return reply.status(201).send(quote);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/v1/quotes/:id',
    { preHandler: requireAuth(db, 'quotes:read') },
    async (request) => getQuote(db, principalOf(request), request.params.id, clock()),
  );

  // Reading the quote first applies its rule: a quote is visible to its own program only.
  app.get<{ Params: { id: string } }>(
    '/v1/quotes/:id/policy',
    { preHandler: requireAuth(db, 'quotes:read') },
    async (request) => {
      const quote = await getQuote(db, principalOf(request), request.params.id, clock());
      const policy = (await getPoliciesByQuote(db, [quote.id])).get(quote.id);
      if (!policy) {
        throw new HttpError(404, 'policy_not_found', `quote ${quote.id} has no policy yet`);
      }
      return policy;
    },
  );

  app.post<{ Params: { id: string } }>(
    '/v1/quotes/:id/bind',
    { preHandler: requireAuth(db, 'quotes:write') },
    async (request) => {
      const { paymentToken } = BindBody.parse(request.body);
      const renter = await renterOf(db, request, clock());
      return idempotent(db, request, (trx) =>
        bindQuote(
          trx,
          principalOf(request),
          request.params.id,
          paymentToken,
          payments,
          clock(),
          renter?.id ?? null,
        ),
      );
    },
  );

  // The signed-in renter's own quotes, across every program, each with the policy it became.
  app.get(
    '/v1/renters/me/quotes',
    { preHandler: requireAuth(db, 'quotes:read') },
    async (request) => {
      const renter = await requireRenter(db, request, clock());
      return { quotes: await quotesOfRenter(db, renter.id, clock()) };
    },
  );
}
