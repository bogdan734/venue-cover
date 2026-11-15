import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { Database } from '../../db/types.js';
import { PROVINCES } from '../../domain/types.js';
import { HttpError } from '../../http/errors.js';
import { idempotent, principalOf, requireAuth } from '../auth/index.js';
import type { Embedder } from '../catalogue/index.js';
import type { LlmProvider } from '../intake/index.js';
import type { Shield } from '../privacy/index.js';
import {
  assertOwns,
  getProgramRules,
  listBrokers,
  listProgramsWithBroker,
  ProgramRulesChanges,
} from '../programs/index.js';
import { draftRules } from './draft.js';
import { previewRules } from './preview.js';
import { createProgramFromTemplate, getProgramDetail, publishChanges } from './service.js';
import { TEMPLATES } from './templates.js';

export const ProgramBody = z.object({
  templateId: z.string().min(1),
  name: z.string().trim().min(2).max(120),
  code: z
    .string()
    .regex(/^[A-Z][A-Z0-9]{2,5}$/, 'a program code is 3 to 6 capital letters or digits'),
  province: z.enum(PROVINCES),
  brokerId: z.string().min(1),
  terms: z
    .object({
      loadingBps: z.number().int().min(0).max(9000),
      commissionBps: z.number().int().min(0).max(9000),
      feeCents: z.number().int().min(0).max(100_000),
    })
    .partial()
    .optional(),
  rules: ProgramRulesChanges.optional(),
});
export const PublishBody = z.object({ changes: ProgramRulesChanges, effectiveFrom: z.iso.date() });
export const DraftBody = z.object({ text: z.string().trim().min(3).max(10_000) });
export const PreviewBody = z.object({
  changes: ProgramRulesChanges,
  sample: z.number().int().min(1).max(200).default(100),
});

export interface SetupRouteDeps {
  db: Kysely<Database>;
  llm: LlmProvider;
  embedder: Embedder;
  shield: Shield;
  clock: () => Date;
}

export function registerSetupRoutes(app: FastifyInstance, deps: SetupRouteDeps): void {
  const { db, clock } = deps;
  const guard = requireAuth(db, 'programs:manage');

  app.post('/v1/programs', { preHandler: guard }, async (request, reply) => {
    if (principalOf(request).programId !== null) {
      throw new HttpError(403, 'forbidden', 'only a key without a program can create programs');
    }
    const body = ProgramBody.parse(request.body);
    const program = await idempotent(db, request, (trx) =>
      createProgramFromTemplate(trx, principalOf(request), body, clock()),
    );
    return reply.status(201).send(program);
  });

  // An operator sees every program; a key bound to a program sees that one.
  app.get('/v1/programs', { preHandler: guard }, async (request) => ({
    programs: await listProgramsWithBroker(db, principalOf(request).programId ?? undefined),
  }));

  // What a new program can be made from.
  app.get('/v1/program-options', { preHandler: guard }, async () => ({
    templates: Object.entries(TEMPLATES).map(([id, template]) => ({ id, ...template })),
    brokers: await listBrokers(db),
  }));

  app.get<{ Params: { id: string } }>('/v1/programs/:id', { preHandler: guard }, async (request) =>
    getProgramDetail(db, principalOf(request), request.params.id, clock()),
  );

  app.post<{ Params: { id: string } }>(
    '/v1/programs/:id/rules',
    { preHandler: guard },
    async (request, reply) => {
      const { changes, effectiveFrom } = PublishBody.parse(request.body);
      const published = await idempotent(db, request, (trx) =>
        publishChanges(
          trx,
          principalOf(request),
          request.params.id,
          changes,
          effectiveFrom,
          clock(),
        ),
      );
      return reply.status(201).send(published);
    },
  );

  // Proposes changes from written requirements. Read-only: publishing is a separate, deliberate call.
  app.post<{ Params: { id: string } }>(
    '/v1/programs/:id/rules/draft',
    { preHandler: guard },
    async (request) => {
      assertOwns(principalOf(request), request.params.id);
      const { text } = DraftBody.parse(request.body);
      const current = await getProgramRules(
        db,
        request.params.id,
        clock().toISOString().slice(0, 10),
      );
      return draftRules(text, current, deps);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/v1/programs/:id/rules/preview',
    { preHandler: guard },
    async (request) => {
      assertOwns(principalOf(request), request.params.id);
      const { changes, sample } = PreviewBody.parse(request.body);
      return previewRules(db, request.params.id, changes, sample, clock());
    },
  );
}
