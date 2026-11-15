import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError } from '../../http/errors.js';
import { principalOf, requireAuth } from '../auth/index.js';
import { getActivities, getActivity, matchActivities } from '../catalogue/index.js';
import { getProgramRules } from '../programs/index.js';
import {
  answersToReasons,
  checkAnswers,
  nextQuestions,
  prefill,
  type QuestionContext,
} from '../questions/index.js';
import { decide, inputFromClassification } from '../underwriting/index.js';
import { CLASS_RANK, getClassificationRecord, primaryOf } from './classification.js';
import { type ClassifyDeps, classifyEvent } from './classify.js';

export const ClassifyBody = z.object({ text: z.string().trim().min(3).max(2000) });
export const QuestionsBody = z.object({
  classificationId: z.string().min(1),
  answers: z
    .record(z.string(), z.union([z.string().max(200), z.number(), z.boolean()]))
    .default({}),
  /** What the customer has confirmed or corrected since the description was read. */
  confirmed: z
    .object({
      activityId: z.string().min(1),
      participants: z.number().int().min(1).max(1_000_000),
      hours: z.number().positive().max(10_000),
      alcohol: z.enum(['none', 'served', 'sold']),
    })
    .partial()
    .default({}),
});
const SearchQuery = z.object({ q: z.string().trim().min(1).max(120) });
const TitlesQuery = z.object({
  ids: z
    .string()
    .default('')
    .transform((value) => value.split(',').filter(Boolean).slice(0, 50)),
});

export function registerIntakeRoutes(
  app: FastifyInstance,
  deps: ClassifyDeps & { clock: () => Date },
): void {
  const { db, embedder, clock } = deps;

  // Safe to repeat, so it takes no Idempotency-Key: a retry only classifies again.
  app.post(
    '/v1/intake/classify',
    { preHandler: requireAuth(db, 'quotes:write') },
    async (request) => {
      const { text } = ClassifyBody.parse(request.body);
      const programId = principalOf(request).programId;
      if (!programId)
        throw new HttpError(403, 'forbidden', 'the API key is not bound to a program');

      const classification = await classifyEvent(deps, { text, programId });
      const rules = await getProgramRules(db, programId, clock().toISOString().slice(0, 10));
      // Nobody has been named yet, so screening waits for the quote; the decision shows what is missing or risky now.
      const decision = decide(
        inputFromClassification(classification, { match: false, score: 0, entryId: null }),
        rules,
      );
      return { ...classification, decision };
    },
  );

  // A classification read back: what was understood, and what today's rules make of it.
  app.get<{ Params: { id: string } }>(
    '/v1/intake/classifications/:id',
    { preHandler: requireAuth(db, 'quotes:read') },
    async (request) => {
      const { programId, scopes } = principalOf(request);
      if (!programId)
        throw new HttpError(403, 'forbidden', 'the API key is not bound to a program');
      const record = await getClassificationRecord(db, request.params.id, programId, {
        shield: deps.shield,
        personal: scopes.includes('personal:read'),
      });
      if (!record) {
        throw new HttpError(
          404,
          'classification_not_found',
          `no classification ${request.params.id}`,
        );
      }
      const rules = await getProgramRules(db, programId, clock().toISOString().slice(0, 10));
      const classification = { ...record, primary: primaryOf(record) };
      const decision = decide(
        inputFromClassification(classification, { match: false, score: 0, entryId: null }),
        rules,
      );
      return { ...classification, decision };
    },
  );

  // What is still worth asking after a description: only the program's questions that apply and are not answered yet.
  app.post(
    '/v1/intake/questions',
    { preHandler: requireAuth(db, 'quotes:write') },
    async (request) => {
      const { classificationId, answers, confirmed } = QuestionsBody.parse(request.body);
      const programId = principalOf(request).programId;
      if (!programId)
        throw new HttpError(403, 'forbidden', 'the API key is not bound to a program');
      const record = await getClassificationRecord(db, classificationId, programId);
      if (!record)
        throw new HttpError(
          404,
          'classification_not_found',
          `no classification ${classificationId}`,
        );

      const rules = await getProgramRules(db, programId, clock().toISOString().slice(0, 10));
      // The same context a quote is checked with: what the customer confirmed wins over what the text said, and
      // the class is the highest one seen.
      const activityId = confirmed.activityId ?? primaryOf(record)?.activityId;
      const activity = activityId ? await getActivity(db, activityId) : undefined;
      if (confirmed.activityId && !activity) {
        throw new HttpError(404, 'activity_not_found', `no activity ${confirmed.activityId}`);
      }
      const chosen = confirmed.activityId ? (activity?.riskClass ?? null) : null;
      const riskClass =
        chosen && (!record.riskClass || CLASS_RANK[chosen] > CLASS_RANK[record.riskClass])
          ? chosen
          : record.riskClass;
      const ctx: QuestionContext = {
        facts: {
          ...record.facts,
          ...(confirmed.participants === undefined ? {} : { participants: confirmed.participants }),
          ...(confirmed.hours === undefined ? {} : { hours: confirmed.hours }),
          ...(confirmed.alcohol === undefined ? {} : { alcohol: confirmed.alcohol }),
        },
        riskClass,
        productCode: activity?.product.code ?? null,
      };
      const problems = checkAnswers(rules.questions, answers);
      if (problems.length > 0) throw new HttpError(400, 'invalid_answers', problems.join('; '));
      return {
        prefilled: prefill(rules.questions, ctx),
        open: nextQuestions(rules.questions, ctx, answers),
        reasons: answersToReasons(rules.questions, ctx, answers),
      };
    },
  );

  // Names for ids the API has handed out, such as a program's excluded activities.
  app.get(
    '/v1/activity-titles',
    { preHandler: requireAuth(db, 'quotes:read') },
    async (request) => {
      const { ids } = TitlesQuery.parse(request.query);
      const found = await getActivities(db, ids);
      return {
        titles: Object.fromEntries([...found].map(([id, activity]) => [id, activity.title])),
      };
    },
  );

  app.get('/v1/activities', { preHandler: requireAuth(db, 'quotes:read') }, async (request) => {
    const { q } = SearchQuery.parse(request.query);
    const [matches] = await matchActivities(db, [q], embedder, 10);
    return { activities: matches ?? [] };
  });
}
