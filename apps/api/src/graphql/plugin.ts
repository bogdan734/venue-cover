import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import mercurius from 'mercurius';
import { requireAuth } from '../modules/auth/index.js';
import type { ServerDeps } from '../server.js';
import { contextFor } from './context.js';
import { buildLoaders } from './loaders.js';
import { resolvers } from './resolvers.js';

// The deepest selection a query may nest. Every field here is cheap, but depth is what turns a list of lists of lists
// into a query that asks for the whole database.
export const MAX_QUERY_DEPTH = 8;

export function registerGraphql(app: FastifyInstance, deps: ServerDeps): void {
  const schema = readFileSync(join(import.meta.dirname, 'schema.graphql'), 'utf8');
  app.register(async (scope) => {
    // Same keys as the REST API: no key, or a bad one, never reaches the executor.
    scope.addHook('preHandler', requireAuth(deps.db));
    await scope.register(mercurius, {
      schema,
      resolvers: resolvers as never,
      loaders: buildLoaders(deps) as never,
      context: (request) => contextFor(deps, request),
      path: '/graphql',
      graphiql: false,
      // Failures before execution (no key, a body that is not JSON) use the API's normal error shape.
      errorHandler: false,
      queryDepth: MAX_QUERY_DEPTH,
    });
  });
}
