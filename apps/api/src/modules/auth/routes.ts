import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { Database } from '../../db/types.js';
import { SCOPES } from '../../domain/types.js';
import { HttpError } from '../../http/errors.js';
import { getProgram } from '../programs/index.js';
import { principalOf, requireAuth } from './guard.js';
import { createApiKey } from './keys.js';

export const ApiKeyBody = z.object({
  programId: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  scopes: z.array(z.enum(SCOPES)).min(1).max(SCOPES.length),
});

export function registerAuthRoutes(app: FastifyInstance, db: Kysely<Database>): void {
  app.get('/v1/me', { preHandler: requireAuth(db) }, async (request) => principalOf(request));

  // Issues a key for one program. Only a key without a program may issue keys, and it cannot hand out a scope it does
  // not hold itself. There is no Idempotency-Key here on purpose: replaying the answer would mean storing the secret.
  app.post(
    '/v1/api-keys',
    { preHandler: requireAuth(db, 'programs:manage') },
    async (request, reply) => {
      const issuer = principalOf(request);
      if (issuer.programId !== null) {
        throw new HttpError(403, 'forbidden', 'only a key without a program can issue keys');
      }
      const body = ApiKeyBody.parse(request.body);
      const beyond = body.scopes.filter((scope) => !issuer.scopes.includes(scope));
      if (beyond.length > 0) {
        throw new HttpError(
          403,
          'forbidden',
          `a key cannot grant a scope it does not hold: ${beyond.join(', ')}`,
        );
      }
      if (!(await getProgram(db, body.programId))) {
        throw new HttpError(404, 'program_not_found', `no program ${body.programId}`);
      }
      const created = await createApiKey(db, {
        name: body.name,
        programId: body.programId,
        scopes: [...new Set(body.scopes)],
      });
      return reply.status(201).send(created);
    },
  );
}
