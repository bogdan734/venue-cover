import { describe, expect, it } from 'vitest';
import type { Condition, QuestionDef } from '../../domain/types.js';
import {
  answersToReasons,
  applies,
  checkAnswers,
  nextQuestions,
  prefill,
  type QuestionContext,
  QuestionDefsSchema,
  STANDARD_QUESTIONS,
} from './index.js';

const ctx = (
  over: Partial<QuestionContext['facts']> = {},
  rest: Partial<QuestionContext> = {},
): QuestionContext => ({
  facts: { participants: 60, hours: 4, alcohol: 'none', flags: [], ...over },
  riskClass: 'B',
  productCode: 'room_rental',
  ...rest,
});
const ids = (defs: QuestionDef[], c: QuestionContext, answers = {}) =>
  nextQuestions(defs, c, answers).map((q) => q.id);

describe('conditions', () => {
  const check = (condition: Condition, c = ctx()) => applies(condition, c);

  it('reads the facts, the class and the product', () => {
    expect(check({ always: true })).toBe(true);
    expect(check({ flag: 'minors' })).toBe(false);
    expect(check({ flag: 'minors' }, ctx({ flags: ['minors'] }))).toBe(true);
    expect(check({ alcohol: ['served', 'sold'] }, ctx({ alcohol: 'sold' }))).toBe(true);
    expect(check({ alcohol: ['served', 'sold'] })).toBe(false);
    expect(check({ riskClass: ['C'] })).toBe(false);
    expect(check({ productCode: ['room_rental'] })).toBe(true);
    expect(check({ minParticipants: 60 })).toBe(true);
    expect(check({ minParticipants: 61 })).toBe(false);
  });

  it('does not guess when a fact is not stated', () => {
    expect(check({ minParticipants: 10 }, ctx({ participants: null }))).toBe(false);
    expect(check({ alcohol: ['served'] }, ctx({ alcohol: null }))).toBe(false);
  });

  it('nests all, any and not', () => {
    const served: Condition = { alcohol: ['served'] };
    const big: Condition = { minParticipants: 100 };
    const c = ctx({ alcohol: 'served', participants: 150 });
    expect(check({ all: [served, big] }, c)).toBe(true);
    expect(check({ all: [served, { not: big }] }, c)).toBe(false);
    expect(check({ any: [{ flag: 'fireworks' }, big] }, c)).toBe(true);
    expect(check({ any: [] }, c)).toBe(false);
    expect(check({ all: [] }, c)).toBe(true);
  });
});

describe('nextQuestions', () => {
  it('hides a question whose condition does not hold and shows it when it does', () => {
    expect(ids(STANDARD_QUESTIONS, ctx())).toEqual([]);
    expect(ids(STANDARD_QUESTIONS, ctx({ alcohol: 'served' }))).toEqual(['server_training']);
    expect(ids(STANDARD_QUESTIONS, ctx({ flags: ['minors', 'inflatables'] }))).toEqual([
      'waivers_minors',
      'inflatable_supervision',
    ]);
    expect(ids(STANDARD_QUESTIONS, ctx({ participants: 300 }))).toEqual(['security_plan']);
  });

  it('does not ask again what was answered', () => {
    const c = ctx({ alcohol: 'sold', flags: ['minors'] });
    expect(ids(STANDARD_QUESTIONS, c)).toEqual(['server_training', 'waivers_minors']);
    expect(ids(STANDARD_QUESTIONS, c, { server_training: true })).toEqual(['waivers_minors']);
    expect(ids(STANDARD_QUESTIONS, c, { server_training: false, waivers_minors: true })).toEqual(
      [],
    );
  });

  it('does not ask what the description already answers', () => {
    const defs: QuestionDef[] = [
      {
        id: 'crowd',
        text: 'How many people come at the peak?',
        type: 'number',
        appliesWhen: { always: true },
        answerFrom: 'participants',
      },
      {
        id: 'length',
        text: 'How many hours does it last?',
        type: 'number',
        appliesWhen: { always: true },
        answerFrom: 'hours',
      },
    ];
    expect(prefill(defs, ctx())).toEqual({ crowd: 60, length: 4 });
    expect(ids(defs, ctx())).toEqual([]);
    expect(ids(defs, ctx({ participants: null }))).toEqual(['crowd']);
  });

  it('adds a question from data alone, with no code change', () => {
    const defs: QuestionDef[] = [
      ...STANDARD_QUESTIONS,
      {
        id: 'fire_marshal',
        text: 'Will a fire marshal attend?',
        type: 'yesno',
        appliesWhen: { minParticipants: 500 },
        referIf: { equals: false },
      },
    ];
    expect(ids(defs, ctx({ participants: 400 }))).not.toContain('fire_marshal');
    expect(ids(defs, ctx({ participants: 600 }))).toContain('fire_marshal');
  });

  it('carries the choices of a choice question', () => {
    const [question] = nextQuestions(STANDARD_QUESTIONS, ctx({ flags: ['inflatables'] }), {});
    expect(question).toMatchObject({
      id: 'inflatable_supervision',
      type: 'choice',
      choices: ['operator', 'organizer', 'nobody'],
    });
  });
});

describe('answersToReasons', () => {
  const c = ctx({
    alcohol: 'served',
    flags: ['minors', 'inflatables', 'animals'],
    participants: 300,
  });
  const reasons = (answers: Record<string, string | number | boolean>) =>
    answersToReasons(STANDARD_QUESTIONS, c, answers);

  it('refers on an answer that the program flagged', () => {
    expect(reasons({ server_training: false })).toEqual(['PROGRAM_RULE']);
    expect(reasons({ waivers_minors: false })).toEqual(['PROGRAM_RULE']);
    expect(reasons({ inflatable_supervision: 'nobody' })).toEqual(['PROGRAM_RULE']);
  });

  it('does not refer on a harmless answer, an unanswered question or a question that does not apply', () => {
    expect(
      reasons({ server_training: true, waivers_minors: true, inflatable_supervision: 'operator' }),
    ).toEqual([]);
    expect(reasons({})).toEqual([]);
    expect(answersToReasons(STANDARD_QUESTIONS, ctx(), { server_training: false })).toEqual([]);
  });

  it('applies numeric limits', () => {
    const defs: QuestionDef[] = [
      {
        id: 'vendors',
        text: 'How many vendors will there be?',
        type: 'number',
        appliesWhen: { always: true },
        referIf: { atLeast: 20 },
      },
      {
        id: 'stages',
        text: 'How many stages will there be?',
        type: 'number',
        appliesWhen: { always: true },
        referIf: { atMost: 0 },
      },
    ];
    expect(answersToReasons(defs, ctx(), { vendors: 19, stages: 1 })).toEqual([]);
    expect(answersToReasons(defs, ctx(), { vendors: 20 })).toEqual(['PROGRAM_RULE']);
    expect(answersToReasons(defs, ctx(), { stages: 0 })).toEqual(['PROGRAM_RULE']);
  });
});

describe('checkAnswers', () => {
  it('accepts answers of the right type for known questions', () => {
    expect(
      checkAnswers(STANDARD_QUESTIONS, {
        server_training: true,
        inflatable_supervision: 'operator',
      }),
    ).toEqual([]);
  });

  it('reports an unknown question, a wrong type and a choice that is not offered', () => {
    const problems = checkAnswers(STANDARD_QUESTIONS, {
      nope: true,
      server_training: 'yes',
      inflatable_supervision: 'robot',
    });
    expect(problems).toHaveLength(3);
    expect(problems.join(' ')).toMatch(/nope/);
    expect(problems.join(' ')).toMatch(/server_training/);
    expect(problems.join(' ')).toMatch(/inflatable_supervision/);
  });
});

describe('QuestionDefsSchema', () => {
  const ok = { id: 'ok_one', text: 'Is this fine?', type: 'yesno', appliesWhen: { always: true } };

  it('accepts the standard set', () => {
    expect(QuestionDefsSchema.safeParse(STANDARD_QUESTIONS).success).toBe(true);
  });

  it('rejects duplicate ids, a choice question without choices and mismatched limits', () => {
    expect(QuestionDefsSchema.safeParse([ok, ok]).success).toBe(false);
    expect(QuestionDefsSchema.safeParse([{ ...ok, type: 'choice' }]).success).toBe(false);
    expect(QuestionDefsSchema.safeParse([{ ...ok, referIf: { atLeast: 3 } }]).success).toBe(false);
    expect(
      QuestionDefsSchema.safeParse([{ ...ok, type: 'number', referIf: { equals: true } }]).success,
    ).toBe(false);
    expect(QuestionDefsSchema.safeParse([{ ...ok, answerFrom: 'hours' }]).success).toBe(false);
    expect(QuestionDefsSchema.safeParse([{ ...ok, id: 'Bad Id' }]).success).toBe(false);
    expect(
      QuestionDefsSchema.safeParse([{ ...ok, appliesWhen: { sometimes: true } }]).success,
    ).toBe(false);
  });
});
