import { describe, expect, it } from 'vitest';
import type { ProgramRules } from '../../domain/types.js';
import { STANDARD_QUESTIONS } from '../questions/index.js';
import { ProgramRulesChanges, parseRules, resolveRules } from './index.js';

const base: ProgramRules = {
  autoConfidenceMin: 0.8,
  autoMaxClass: 'B',
  maxParticipantsAuto: 300,
  alcoholAuto: true,
  excludedActivityIds: ['act_0001'],
  limitsCents: [200_000_000],
  questions: STANDARD_QUESTIONS,
};

describe('program rules', () => {
  it('lets a change set name only what it changes', () => {
    expect(Object.keys(ProgramRulesChanges.parse({ maxParticipantsAuto: 100 }))).toEqual([
      'maxParticipantsAuto',
    ]);
    expect(ProgramRulesChanges.parse({})).toEqual({});
  });

  it('keeps every rule that a change does not name', () => {
    const next = resolveRules(base, ProgramRulesChanges.parse({ maxParticipantsAuto: 100 }));
    expect(next).toEqual({ ...base, maxParticipantsAuto: 100 });
    expect(next.excludedActivityIds).toEqual(['act_0001']);
    expect(next.limitsCents).toEqual([200_000_000]);
    expect(next.questions).toEqual(STANDARD_QUESTIONS);
  });

  it('rejects values outside the allowed ranges and unknown fields', () => {
    for (const bad of [
      { autoConfidenceMin: 0.2 },
      { autoConfidenceMin: 1 },
      { maxParticipantsAuto: 501 },
      { autoMaxClass: 'X' },
      { limitsCents: [] },
      { surprise: 1 },
    ]) {
      expect(ProgramRulesChanges.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('reads rules stored before a field existed with that field at its default', () => {
    const old = {
      autoConfidenceMin: 0.8,
      autoMaxClass: 'B',
      maxParticipantsAuto: 300,
      alcoholAuto: true,
    };
    expect(parseRules(old)).toEqual({
      ...old,
      excludedActivityIds: [],
      limitsCents: [200_000_000, 500_000_000],
      questions: [],
    });
  });
});
