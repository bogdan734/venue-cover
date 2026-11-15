import type {
  Answer,
  AnswerMap,
  Condition,
  EventFacts,
  QuestionDef,
  ReferralReason,
  RiskClass,
} from '../../domain/types.js';

// What a condition can look at. A fact that is not stated (null) matches nothing: a question is never hidden or
// shown on a guess.
export interface QuestionContext {
  facts: Pick<EventFacts, 'participants' | 'hours' | 'alcohol' | 'flags'>;
  riskClass: RiskClass | null;
  productCode: string | null;
}

export interface OpenQuestion {
  id: string;
  text: string;
  type: QuestionDef['type'];
  choices?: string[];
}

export function applies(condition: Condition, ctx: QuestionContext): boolean {
  if ('always' in condition) return true;
  if ('flag' in condition) return ctx.facts.flags.includes(condition.flag);
  if ('alcohol' in condition)
    return ctx.facts.alcohol !== null && condition.alcohol.includes(ctx.facts.alcohol);
  if ('productCode' in condition)
    return ctx.productCode !== null && condition.productCode.includes(ctx.productCode);
  if ('riskClass' in condition)
    return ctx.riskClass !== null && condition.riskClass.includes(ctx.riskClass);
  if ('minParticipants' in condition)
    return ctx.facts.participants !== null && ctx.facts.participants >= condition.minParticipants;
  if ('all' in condition) return condition.all.every((c) => applies(c, ctx));
  if ('any' in condition) return condition.any.some((c) => applies(c, ctx));
  return !applies(condition.not, ctx);
}

// Answers the description already gives.
export function prefill(defs: QuestionDef[], ctx: QuestionContext): AnswerMap {
  const out: AnswerMap = {};
  for (const def of defs) {
    if (!def.answerFrom || !applies(def.appliesWhen, ctx)) continue;
    const value = ctx.facts[def.answerFrom];
    if (value !== null) out[def.id] = value;
  }
  return out;
}

// The questions that apply and are not answered yet, in the order the program lists them.
export function nextQuestions(
  defs: QuestionDef[],
  ctx: QuestionContext,
  answers: AnswerMap,
): OpenQuestion[] {
  const known = { ...prefill(defs, ctx), ...answers };
  return defs
    .filter((def) => applies(def.appliesWhen, ctx) && known[def.id] === undefined)
    .map(({ id, text, type, choices }) => ({ id, text, type, ...(choices ? { choices } : {}) }));
}

function triggers(def: QuestionDef, answer: Answer): boolean {
  const { equals, atLeast, atMost } = def.referIf ?? {};
  if (equals !== undefined && answer === equals) return true;
  if (typeof answer === 'number') {
    if (atLeast !== undefined && answer >= atLeast) return true;
    if (atMost !== undefined && answer <= atMost) return true;
  }
  return false;
}

// Only questions that apply count: an answer to a question that was never asked cannot refer a quote.
export function answersToReasons(
  defs: QuestionDef[],
  ctx: QuestionContext,
  answers: AnswerMap,
): ReferralReason[] {
  const known = { ...prefill(defs, ctx), ...answers };
  const hit = defs.some((def) => {
    const answer = known[def.id];
    return answer !== undefined && applies(def.appliesWhen, ctx) && triggers(def, answer);
  });
  return hit ? ['PROGRAM_RULE'] : [];
}

// Problems with a set of answers: an unknown question, the wrong type, a choice that is not offered.
export function checkAnswers(defs: QuestionDef[], answers: AnswerMap): string[] {
  const problems: string[] = [];
  for (const [id, answer] of Object.entries(answers)) {
    const def = defs.find((d) => d.id === id);
    if (!def) {
      problems.push(`no question ${id}`);
    } else if (def.type === 'yesno' && typeof answer !== 'boolean') {
      problems.push(`${id} needs true or false`);
    } else if (def.type === 'number' && (typeof answer !== 'number' || !Number.isFinite(answer))) {
      problems.push(`${id} needs a number`);
    } else if (
      def.type === 'choice' &&
      (typeof answer !== 'string' || !def.choices?.includes(answer))
    ) {
      problems.push(`${id} needs one of ${def.choices?.join(', ')}`);
    }
  }
  return problems;
}
