import type { FastifyRequest } from 'fastify';
import mercurius from 'mercurius';
import { ZodError } from 'zod';
import type { Scope } from '../domain/types.js';
import { HttpError } from '../http/errors.js';
import {
  fingerprint,
  type Principal,
  principalOf,
  withIdempotency,
} from '../modules/auth/index.js';
import type { ServerDeps } from '../server.js';

export interface GqlContext {
  deps: ServerDeps;
  principal: Principal;
  request: FastifyRequest;
}

export function contextFor(deps: ServerDeps, request: FastifyRequest): GqlContext {
  return { deps, principal: principalOf(request), request };
}

const CODES: Record<number, string> = {
  400: 'BAD_USER_INPUT',
  401: 'UNAUTHENTICATED',
  402: 'PAYMENT_REQUIRED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'BAD_USER_INPUT',
};

// Failures leave as GraphQL errors with a stable `code`, and the REST error code as `reason`.
export function toGraphqlError(error: unknown): Error {
  if (error instanceof HttpError) {
    return new mercurius.ErrorWithProps(error.message, {
      code: CODES[error.status] ?? 'INTERNAL',
      reason: error.code,
    });
  }
  if (error instanceof ZodError) {
    const message = error.issues
      .map((i) => `${i.path.join('.') || 'input'}: ${i.message}`)
      .join('; ');
    return new mercurius.ErrorWithProps(message, {
      code: 'BAD_USER_INPUT',
      reason: 'validation_error',
    });
  }
  return new mercurius.ErrorWithProps('internal error', { code: 'INTERNAL' });
}

export function requireScope(ctx: GqlContext, scope: Scope): void {
  if (!ctx.principal.scopes.includes(scope)) {
    throw new HttpError(403, 'forbidden', `the API key lacks the scope ${scope}`);
  }
}

// Wraps a resolver so that every failure is reported in the same shape.
export function guarded<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      throw toGraphqlError(error);
    }
  };
}

// The Idempotency-Key header covers a mutation field; the field's response key (its alias, or its name) is appended so
// a request with two mutations keeps their keys apart.
export async function idempotentField<T extends object>(
  ctx: GqlContext,
  field: string,
  args: unknown,
  run: Parameters<typeof withIdempotency<T>>[4],
): Promise<T> {
  const key = ctx.request.headers['idempotency-key'];
  if (typeof key !== 'string' || key.length === 0 || key.length > 150) {
    throw new HttpError(
      400,
      'idempotency_key_required',
      'send an Idempotency-Key header (1 to 150 characters)',
    );
  }
  return withIdempotency(
    ctx.deps.db,
    ctx.principal.keyId,
    `${key}:${field}`,
    fingerprint('POST', `graphql:${field}`, args),
    run,
  );
}
