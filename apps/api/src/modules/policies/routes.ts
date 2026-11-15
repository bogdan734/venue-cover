import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { Database } from '../../db/types.js';
import { HttpError } from '../../http/errors.js';
import { principalOf, requireAuth } from '../auth/index.js';
import { HOLDERS, recipientsOf, renderCertificate } from './certificate.js';
import { getPolicyFor } from './view.js';

const Params = z.object({
  id: z.string().min(1),
  holder: z.enum(HOLDERS as [string, ...string[]]),
});

export function registerPolicyRoutes(app: FastifyInstance, db: Kysely<Database>): void {
  const guard = requireAuth(db, 'quotes:read');

  app.get<{ Params: { id: string } }>('/v1/policies/:id', { preHandler: guard }, async (request) =>
    getPolicyFor(db, principalOf(request), request.params.id),
  );

  app.get<{ Params: { id: string; holder: string } }>(
    '/v1/policies/:id/certificates/:holder',
    { preHandler: guard },
    async (request, reply) => {
      const { id, holder } = Params.parse(request.params);
      // A certificate names people, and a PDF cannot carry tags: only a key allowed to read personal details gets one.
      if (!principalOf(request).scopes.includes('personal:read')) {
        throw new HttpError(403, 'forbidden', 'a certificate names people: it needs personal:read');
      }
      const policy = await getPolicyFor(db, principalOf(request), id);
      if (!recipientsOf(policy).some((r) => r.holder === holder)) {
        throw new HttpError(
          404,
          'certificate_not_issued',
          `no ${holder} certificate for this policy`,
        );
      }
      const bytes = await renderCertificate(policy, holder as (typeof HOLDERS)[number]);
      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', `inline; filename="${policy.policyNumber}-${holder}.pdf"`)
        .send(Buffer.from(bytes));
    },
  );
}
