import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { Database } from '../../db/types.js';
import { PROGRAM_STATUSES } from '../../domain/types.js';
import { HttpError } from '../../http/errors.js';
import { idempotent, principalOf, requireAuth } from '../auth/index.js';
import { assertOwns } from '../programs/index.js';
import { createAccess, listAccess, resolveAccess, revokeAccess } from './access.js';
import { auditOf } from './audit.js';
import { hubClients } from './hub.js';
import { moveTo, setAppearance, setContacts } from './service.js';
import { ContactsBody, ThemeBody } from './theme.js';
import { countVisit } from './visits.js';

export const StatusBody = z.object({ to: z.enum(PROGRAM_STATUSES) });
export const AccessBody = z.object({ label: z.string().trim().min(1).max(80) });
export const ResolveBody = z.object({ token: z.string().min(1).max(200) });

export interface TenantRouteDeps {
  db: Kysely<Database>;
  clock: () => Date;
}

export function registerTenantRoutes(app: FastifyInstance, { db, clock }: TenantRouteDeps): void {
  const manage = requireAuth(db, 'programs:manage');
  type ById = { Params: { id: string } };

  // Appearance and contacts are replaced whole, so sending the same body twice changes nothing.
  app.put<ById>('/v1/programs/:id/appearance', { preHandler: manage }, async (request) => {
    const theme = ThemeBody.parse(request.body);
    return db
      .transaction()
      .execute((trx) => setAppearance(trx, principalOf(request), request.params.id, theme));
  });

  app.put<ById>('/v1/programs/:id/contacts', { preHandler: manage }, async (request) => {
    const contacts = ContactsBody.parse(request.body);
    return db
      .transaction()
      .execute((trx) => setContacts(trx, principalOf(request), request.params.id, contacts));
  });

  app.post<ById>('/v1/programs/:id/status', { preHandler: manage }, async (request) => {
    const { to } = StatusBody.parse(request.body);
    return idempotent(db, request, (trx) =>
      moveTo(trx, principalOf(request), request.params.id, to),
    );
  });

  app.get<ById>('/v1/programs/:id/audit', { preHandler: manage }, async (request) => {
    assertOwns(principalOf(request), request.params.id);
    return { entries: await auditOf(db, request.params.id) };
  });

  // A portal reports a visitor. The key says which program; the Idempotency-Key makes a visitor count once a day.
  app.post('/v1/visits', { preHandler: requireAuth(db, 'quotes:read') }, async (request, reply) => {
    const { programId } = principalOf(request);
    if (!programId) throw new HttpError(403, 'forbidden', 'a visit belongs to a program’s key');
    await idempotent(db, request, async (trx) => {
      await countVisit(trx, programId, clock().toISOString().slice(0, 10));
      return {};
    });
    return reply.status(204).send();
  });

  // Every client for the operator; a program's own key (its client console) gets its own row.
  app.get('/v1/hub/clients', { preHandler: requireAuth(db, 'reports:read') }, async (request) =>
    hubClients(db, clock(), 30, principalOf(request).programId ?? undefined),
  );

  app.post<ById>('/v1/programs/:id/access', { preHandler: manage }, async (request, reply) => {
    const { label } = AccessBody.parse(request.body);
    const link = await idempotent(db, request, (trx) =>
      createAccess(trx, principalOf(request), request.params.id, label),
    );
    return reply.status(201).send(link);
  });

  app.get<ById>('/v1/programs/:id/access', { preHandler: manage }, async (request) => ({
    links: await listAccess(db, principalOf(request), request.params.id),
  }));

  app.post<{ Params: { id: string; accessId: string } }>(
    '/v1/programs/:id/access/:accessId/revoke',
    { preHandler: manage },
    async (request) =>
      idempotent(db, request, (trx) =>
        revokeAccess(
          trx,
          principalOf(request),
          request.params.id,
          request.params.accessId,
          clock(),
        ),
      ),
  );

  app.post('/v1/access/resolve', { preHandler: manage }, async (request) => {
    const { token } = ResolveBody.parse(request.body);
    return resolveAccess(db, principalOf(request), token, clock());
  });
}
