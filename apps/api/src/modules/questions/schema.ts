import { z } from 'zod';
import type { Answer, Condition, QuestionDef } from '../../domain/types.js';

const AnswerSchema = z.union([z.string(), z.number(), z.boolean()]);

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.strictObject({ always: z.literal(true) }),
    z.strictObject({
      flag: z.enum([
        'fireworks',
        'overnight',
        'animals',
        'inflatables',
        'minors',
        'weapons',
        'motorized',
      ]),
    }),
    z.strictObject({ alcohol: z.array(z.enum(['none', 'served', 'sold'])).min(1) }),
    z.strictObject({ productCode: z.array(z.string().min(1)).min(1) }),
    z.strictObject({ riskClass: z.array(z.enum(['A', 'B', 'C', 'X'])).min(1) }),
    z.strictObject({ minParticipants: z.number().int().min(1) }),
    z.strictObject({ all: z.array(ConditionSchema) }),
    z.strictObject({ any: z.array(ConditionSchema) }),
    z.strictObject({ not: ConditionSchema }),
  ]),
);

const QuestionDefSchema: z.ZodType<QuestionDef> = z
  .object({
    id: z
      .string()
      .regex(/^[a-z][a-z0-9_]{1,40}$/, 'an id is lower case letters, digits and underscores'),
    text: z.string().min(5).max(300),
    type: z.enum(['yesno', 'number', 'choice']),
    choices: z.array(z.string().min(1).max(60)).min(2).max(10).optional(),
    appliesWhen: ConditionSchema,
    referIf: z
      .strictObject({
        equals: AnswerSchema.optional(),
        atLeast: z.number().optional(),
        atMost: z.number().optional(),
      })
      .optional(),
    answerFrom: z.enum(['participants', 'hours']).optional(),
  })
  .superRefine((q, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', path: [q.id], message });
    if (q.type === 'choice' && !q.choices) fail('a choice question needs its choices');
    if (q.type !== 'choice' && q.choices) fail('only a choice question has choices');
    if (q.answerFrom && q.type !== 'number')
      fail('only a number question can be answered from the description');
    const { equals, atLeast, atMost } = q.referIf ?? {};
    if (
      q.type === 'yesno' &&
      (typeof equals !== 'boolean' || atLeast !== undefined || atMost !== undefined)
    ) {
      fail('a yes/no question refers on equals true or false');
    }
    if (
      q.type === 'choice' &&
      (typeof equals !== 'string' || !q.choices?.includes(equals)) &&
      q.referIf
    ) {
      fail('a choice question refers on one of its choices');
    }
    if (q.type === 'number' && q.referIf && equals !== undefined)
      fail('a number question refers on atLeast or atMost');
  }) as z.ZodType<QuestionDef>;

// A program's question list: every id appears once.
export const QuestionDefsSchema = z
  .array(QuestionDefSchema)
  .max(50)
  .superRefine((defs, ctx) => {
    const seen = new Set<string>();
    for (const d of defs) {
      if (seen.has(d.id))
        ctx.addIssue({ code: 'custom', message: `the question id ${d.id} is used twice` });
      seen.add(d.id);
    }
  });

export type { Answer };
