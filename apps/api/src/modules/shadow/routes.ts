import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError } from '../../http/errors.js';
import { principalOf, requireAuth } from '../auth/index.js';
import { replay, type ShadowDeps } from './shadow.js';

const Query = z.object({ since: z.iso.date().optional() });

// How often the automation, as it is now, would have made the call people made. Needs a key without a program: it
// reads decisions across every program.
export function registerShadowRoutes(
  app: FastifyInstance,
  deps: Omit<ShadowDeps, 'now'> & { clock: () => Date },
): void {
  app.get(
    '/v1/reports/shadow',
    { preHandler: requireAuth(deps.db, 'reports:read') },
    async (request) => {
      if (principalOf(request).programId !== null) {
        throw new HttpError(
          403,
          'forbidden',
          'the shadow replay covers every program, so it needs a key without a program',
        );
      }
      const now = deps.clock();
      const since =
        Query.parse(request.query).since ??
        new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
      return replay({ ...deps, now }, new Date(`${since}T00:00:00Z`));
    },
  );
}
