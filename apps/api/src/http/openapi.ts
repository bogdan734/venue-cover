import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { Database } from '../db/types.js';
import type { Scope } from '../domain/types.js';
import { requireAuth } from '../modules/auth/index.js';
import type { ApiRoute } from './catalogue.js';
import { OPERATIONS } from './operations.js';

export { OPERATIONS };

export interface OperationDoc {
  summary: string;
  description?: string;
  /** The scope the key needs; absent when any valid key will do. */
  scope?: Scope;
  /** The request needs an Idempotency-Key header. */
  idempotent?: boolean;
  body?: z.ZodType | 'multipart';
  query?: Record<string, string>;
  /** What comes back, when it is not JSON. */
  produces?: 'application/pdf' | 'text/event-stream';
  /** Status code of the success response; 200 when absent. */
  success?: number;
}

export function schemaOf(schema: z.ZodType): Record<string, unknown> {
  try {
    const json = z.toJSONSchema(schema, { unrepresentable: 'any' }) as Record<string, unknown>;
    json.$schema = undefined;
    return JSON.parse(JSON.stringify(json));
  } catch {
    return { type: 'object' };
  }
}

const pathOf = (url: string) => url.replace(/:(\w+)/g, '{$1}');

// Builds the OpenAPI 3.1 document from the routes that exist and the hand-written descriptions of them.
export function buildOpenApi(
  routes: ApiRoute[],
  operations: Record<string, OperationDoc>,
): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of routes) {
    const doc = operations[`${route.method} ${route.url}`];
    if (!doc) throw new Error(`no description for ${route.method} ${route.url}`);
    const parameters: unknown[] = [...route.url.matchAll(/:(\w+)/g)].map((m) => ({
      name: m[1],
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }));
    for (const [name, description] of Object.entries(doc.query ?? {})) {
      parameters.push({
        name,
        in: 'query',
        required: false,
        description,
        schema: { type: 'string' },
      });
    }
    if (doc.idempotent) {
      parameters.push({
        name: 'Idempotency-Key',
        in: 'header',
        required: true,
        description:
          'A unique value for this operation. Repeating the request with the same key returns the first answer; a different request with the same key is refused with 409.',
        schema: { type: 'string', minLength: 1, maxLength: 200 },
      });
    }
    const success = String(doc.success ?? 200);
    const content = doc.produces
      ? {
          [doc.produces]: {
            schema: {
              type: 'string',
              format: doc.produces === 'application/pdf' ? 'binary' : undefined,
            },
          },
        }
      : { 'application/json': { schema: { type: 'object' } } };
    const operation: Record<string, unknown> = {
      summary: doc.summary,
      ...(doc.description ? { description: doc.description } : {}),
      operationId: `${route.method.toLowerCase()}${route.url.replace(/[^a-zA-Z0-9]+(.)?/g, (_, c: string | undefined) => (c ?? '').toUpperCase())}`,
      security: [{ bearerAuth: [] }],
      ...(doc.scope ? { 'x-required-scope': doc.scope } : {}),
      parameters,
      ...(doc.body
        ? {
            requestBody: {
              required: true,
              content:
                doc.body === 'multipart'
                  ? {
                      'multipart/form-data': {
                        schema: {
                          type: 'object',
                          description:
                            'A part named form holds the PDF; each supporting document is a part named after its kind.',
                        },
                      },
                    }
                  : { 'application/json': { schema: schemaOf(doc.body) } },
            },
          }
        : {}),
      responses: {
        [success]: { description: 'Success', content },
        default: {
          description: 'An error',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
    };
    const entry = paths[pathOf(route.url)] ?? {};
    entry[route.method.toLowerCase()] = operation;
    paths[pathOf(route.url)] = entry;
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Venue cover API',
      version: '1',
      description:
        'Quotes, referrals, policies and webhooks for event-liability insurance. A GraphQL endpoint at /graphql offers the same capabilities with the same keys.',
    },
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'An API key: Authorization: Bearer vck_...',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: { code: { type: 'string' }, message: { type: 'string' } },
            },
          },
        },
      },
    },
  };
}

export function registerOpenApi(app: FastifyInstance, db: Kysely<Database>): void {
  app.get('/v1/openapi.json', { preHandler: requireAuth(db) }, async () =>
    buildOpenApi(app.apiRoutes, OPERATIONS),
  );
}
