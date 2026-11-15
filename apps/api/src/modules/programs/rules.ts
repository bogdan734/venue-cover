import { z } from 'zod';
import type { ProgramRules } from '../../domain/types.js';
import { QuestionDefsSchema } from '../questions/index.js';

// The shape of the rules with no defaults, so that a change set built from it carries only what it names.
const shape = z.object({
  autoConfidenceMin: z.number().min(0.5).max(0.99),
  autoMaxClass: z.enum(['A', 'B', 'C']),
  maxParticipantsAuto: z.number().int().min(1).max(500),
  alcoholAuto: z.boolean(),
  excludedActivityIds: z.array(z.string().min(1)).max(500),
  limitsCents: z
    .array(z.union([z.literal(200_000_000), z.literal(500_000_000)]))
    .min(1)
    .max(2),
  questions: QuestionDefsSchema,
});

// The one definition of what a valid set of program rules is. Rules stored before a field existed read with its default.
export const ProgramRulesSchema = shape.extend({
  excludedActivityIds: shape.shape.excludedActivityIds.default([]),
  limitsCents: shape.shape.limitsCents.default([200_000_000, 500_000_000]),
  questions: shape.shape.questions.default([]),
});

// A change set: any subset of the rules, nothing else, and nothing filled in on its own.
export const ProgramRulesChanges = shape.partial().strict();
export type ProgramRulesChangeSet = z.infer<typeof ProgramRulesChanges>;

export function parseRules(value: unknown): ProgramRules {
  return ProgramRulesSchema.parse(value);
}

// Pure: the rules after applying a change set. Everything not named stays as it was.
export function resolveRules(base: ProgramRules, changes: ProgramRulesChangeSet): ProgramRules {
  return ProgramRulesSchema.parse({ ...base, ...changes });
}
