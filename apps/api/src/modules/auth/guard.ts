import type { FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from '../../db/types.js';
import type { Scope } from '../../domain/types.js';
import { HttpError } from '../../http/errors.js';
import { findPrincipal, type Principal } from './keys.js';

declare module 'fastify' {
  interface FastifyRequest {
    principal?: Principal;
  }
}

// Route guard: needs `Authorization: Bearer <key>`, and the scope when one is given.
export function requireAuth(db: Kysely<Database>, scope?: Scope): preHandlerAsyncHookHandler {
  return async (request) => {
    const token = /^Bearer (\S+)$/i.exec(request.headers.authorization ?? '')?.[1];
    const principal = token ? await findPrincipal(db, token) : null;
    if (!principal) throw new HttpError(401, 'unauthorized', 'missing or invalid API key');
    if (scope && !principal.scopes.includes(scope)) {
      throw new HttpError(403, 'forbidden', `the API key lacks the scope ${scope}`);
    }
    request.principal = principal;
  };
}

export function principalOf(request: FastifyRequest): Principal {
  if (!request.principal) throw new Error('route is missing the requireAuth guard');
  return request.principal;
}
