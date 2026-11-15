import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { Database } from '../../db/types.js';
import { newId } from '../../domain/ids.js';
import { EVENT_TYPES } from '../../domain/types.js';
import { HttpError } from '../../http/errors.js';
import { idempotent, principalOf, requireAuth } from '../auth/index.js';
import { appendEvent, getEventTypes } from '../events/index.js';
import { assertAllowedUrl } from './net.js';

export const EndpointBody = z.object({
  url: z.string().max(2000),
  events: z
    .array(
      z
        .enum(EVENT_TYPES)
        .refine(
          (t) => t !== 'webhook.delivery.failed' && t !== 'webhook.test',
          'delivery failures are not sent by webhook, and a test event is sent on request',
        ),
    )
    .min(1)
    .max(20),
});
const DeliveryQuery = z.object({
  endpointId: z.string().min(1).optional(),
  state: z.enum(['pending', 'delivered', 'dead']).optional(),
});

export function registerWebhookRoutes(
  app: FastifyInstance,
  db: Kysely<Database>,
  clock: () => Date,
): void {
  const guard = requireAuth(db, 'webhooks:manage');
  const programOf = (request: Parameters<typeof principalOf>[0]): string => {
    const programId = principalOf(request).programId;
    if (!programId) throw new HttpError(403, 'forbidden', 'the API key is not bound to a program');
    return programId;
  };
  const endpointOf = async (programId: string, id: string) => {
    const row = await db
      .selectFrom('webhook_endpoint')
      .selectAll()
      .where('id', '=', id)
      .where('program_id', '=', programId)
      .executeTakeFirst();
    if (!row) throw new HttpError(404, 'endpoint_not_found', `no webhook endpoint ${id}`);
    return row;
  };
  const endpointView = (row: {
    id: string;
    url: string;
    events: string[];
    active: boolean;
    created_at: Date;
  }) => ({
    id: row.id,
    url: row.url,
    events: row.events,
    active: row.active,
    createdAt: row.created_at.toISOString(),
  });

  // No Idempotency-Key here on purpose: the secret is shown once and must not sit in the idempotency store.
  app.post('/v1/webhook-endpoints', { preHandler: guard }, async (request, reply) => {
    const programId = programOf(request);
    const body = EndpointBody.parse(request.body);
    try {
      assertAllowedUrl(body.url);
    } catch (error) {
      throw new HttpError(
        400,
        'invalid_url',
        error instanceof Error && error.name !== 'TypeError'
          ? error.message
          : 'the URL is not valid',
      );
    }
    const secret = `whsec_${randomBytes(24).toString('base64url')}`;
    const row = await db
      .insertInto('webhook_endpoint')
      .values({
        id: newId('whe'),
        program_id: programId,
        url: body.url,
        secret,
        events: [...new Set(body.events)],
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return reply.status(201).send({ ...endpointView(row), secret });
  });

  app.get('/v1/webhook-endpoints', { preHandler: guard }, async (request) => {
    const rows = await db
      .selectFrom('webhook_endpoint')
      .selectAll()
      .where('program_id', '=', programOf(request))
      .orderBy('created_at', 'desc')
      .limit(200)
      .execute();
    return { endpoints: rows.map(endpointView) };
  });

  // Deactivates rather than deletes, so past deliveries keep their endpoint.
  app.delete<{ Params: { id: string } }>(
    '/v1/webhook-endpoints/:id',
    { preHandler: guard },
    async (request, reply) => {
      const endpoint = await endpointOf(programOf(request), request.params.id);
      await db
        .updateTable('webhook_endpoint')
        .set({ active: false })
        .where('id', '=', endpoint.id)
        .execute();
      return reply.status(204).send();
    },
  );

  const deliveryView = (
    row: {
      id: string;
      endpoint_id: string;
      event_id: string;
      attempt: number;
      state: string;
      next_attempt_at: Date;
      last_status: number | null;
      last_error: string | null;
      created_at: Date;
    },
    eventType: string | undefined,
  ) => ({
    id: row.id,
    endpointId: row.endpoint_id,
    eventId: row.event_id,
    eventType: eventType ?? null,
    attempt: row.attempt,
    state: row.state,
    nextAttemptAt: row.next_attempt_at.toISOString(),
    lastStatus: row.last_status,
    lastError: row.last_error,
    createdAt: row.created_at.toISOString(),
  });

  app.get('/v1/webhook-deliveries', { preHandler: guard }, async (request) => {
    const programId = programOf(request);
    const { endpointId, state } = DeliveryQuery.parse(request.query);
    let query = db
      .selectFrom('webhook_delivery')
      .selectAll()
      .where(
        'endpoint_id',
        'in',
        db.selectFrom('webhook_endpoint').select('id').where('program_id', '=', programId),
      );
    if (endpointId) query = query.where('endpoint_id', '=', endpointId);
    if (state) query = query.where('state', '=', state);
    const rows = await query.orderBy('created_at', 'desc').limit(100).execute();
    const types = await getEventTypes(
      db,
      rows.map((r) => r.event_id),
    );
    return { deliveries: rows.map((r) => deliveryView(r, types.get(r.event_id))) };
  });

  // A signed `webhook.test` event to this one endpoint, so a receiver can be checked before real events reach it.
  app.post<{ Params: { id: string } }>(
    '/v1/webhook-endpoints/:id/test',
    { preHandler: guard },
    async (request, reply) => {
      const programId = programOf(request);
      const sent = await idempotent(db, request, async (trx) => {
        const endpoint = await trx
          .selectFrom('webhook_endpoint')
          .select(['id', 'url'])
          .where('id', '=', request.params.id)
          .where('program_id', '=', programId)
          .executeTakeFirst();
        if (!endpoint) {
          throw new HttpError(
            404,
            'endpoint_not_found',
            `no webhook endpoint ${request.params.id}`,
          );
        }
        const event = await appendEvent(trx, {
          type: 'webhook.test',
          programId,
          data: { endpointId: endpoint.id, message: 'A test event: no action is needed.' },
        });
        const deliveryId = newId('whd');
        await trx
          .insertInto('webhook_delivery')
          .values({
            id: deliveryId,
            endpoint_id: endpoint.id,
            event_id: event.id,
            next_attempt_at: clock(),
          })
          .execute();
        return { deliveryId, eventId: event.id };
      });
      return reply.status(202).send(sent);
    },
  );

  // Starts a finished delivery over, with the same event id so that a receiver that deduplicates sees one event.
  app.post<{ Params: { id: string } }>(
    '/v1/webhook-deliveries/:id/replay',
    { preHandler: guard },
    async (request) => {
      const programId = programOf(request);
      return db.transaction().execute(async (trx) => {
        const row = await trx
          .selectFrom('webhook_delivery')
          .innerJoin('webhook_endpoint', 'webhook_endpoint.id', 'webhook_delivery.endpoint_id')
          .selectAll('webhook_delivery')
          .where('webhook_delivery.id', '=', request.params.id)
          .where('webhook_endpoint.program_id', '=', programId)
          .forUpdate('webhook_delivery')
          .executeTakeFirst();
        if (!row)
          throw new HttpError(
            404,
            'delivery_not_found',
            `no webhook delivery ${request.params.id}`,
          );
        if (row.state === 'pending')
          throw new HttpError(409, 'delivery_in_progress', 'the delivery is still being attempted');
        const updated = await trx
          .updateTable('webhook_delivery')
          .set({
            state: 'pending',
            attempt: 0,
            next_attempt_at: clock(),
            last_status: null,
            last_error: null,
          })
          .where('id', '=', row.id)
          .returningAll()
          .executeTakeFirstOrThrow();
        const types = await getEventTypes(trx, [updated.event_id]);
        return deliveryView(updated, types.get(updated.event_id));
      });
    },
  );
}
