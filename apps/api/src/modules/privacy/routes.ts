import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from '../../db/types.js';
import { requireAuth } from '../auth/index.js';
import type { GuardStats } from './guard.js';
import type { Shield } from './shield.js';

// How the shield is set up and what the guard on the model has seen since the server started: a live check that call
// sites protect their text (the guard strips nothing when they do).
export function registerPrivacyRoutes(
  app: FastifyInstance,
  deps: { db: Kysely<Database>; shield: Shield; stats: () => GuardStats },
): void {
  app.get('/v1/privacy', { preHandler: requireAuth(deps.db, 'reports:read') }, async () => ({
    names: deps.shield.finder,
    guard: deps.stats(),
  }));
}
