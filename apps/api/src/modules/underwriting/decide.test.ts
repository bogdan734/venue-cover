import { describe, expect, it } from 'vitest';
import type { ProgramRules } from '../../domain/types.js';
import { type DecisionInput, decide } from './index.js';

const rules: ProgramRules = {
  autoConfidenceMin: 0.8,
  autoMaxClass: 'B',
  maxParticipantsAuto: 300,
  alcoholAuto: true,
  excludedActivityIds: ['act_nope'],
  limitsCents: [200_000_000],
  questions: [],
};
const clean: DecisionInput = {
  riskClass: 'A',
  classes: ['A'],
  activityIds: ['act_ok'],
  confidence: 0.92,
  unknownPhrases: 0,
  degraded: false,
  flags: [],
  participants: 40,
  hours: 4,
  alcohol: 'none',
  screen: { match: false, score: 0.1, entryId: null },
};
const withInput = (over: Partial<DecisionInput>, r: ProgramRules = rules) =>
  decide({ ...clean, ...over }, r);

describe('decide', () => {
  it('goes automatic with one class, enough confidence and no flags', () => {
    expect(withInput({})).toEqual({ outcome: 'auto', reasons: [] });
  });

  it('refers on low confidence', () => {
    expect(withInput({ confidence: 0.79 })).toEqual({
      outcome: 'refer',
      reasons: ['LOW_CONFIDENCE'],
    });
    expect(withInput({ confidence: 0.8 }).outcome).toBe('auto');
  });

  it('always refers class X', () => {
    const wide: ProgramRules = { ...rules, autoMaxClass: 'C' };
    expect(withInput({ riskClass: 'X', classes: ['X'] }, wide).reasons).toContain(
      'EXCLUDED_ACTIVITY',
    );
  });

  it('refers an activity the program has excluded, whatever its class', () => {
    expect(withInput({ activityIds: ['act_ok', 'act_nope'] })).toEqual({
      outcome: 'refer',
      reasons: ['EXCLUDED_ACTIVITY'],
    });
  });

  it('refers a class above what the program allows automatically', () => {
    expect(withInput({ riskClass: 'C', classes: ['C'] }).reasons).toEqual(['PROGRAM_RULE']);
    expect(
      withInput({ riskClass: 'C', classes: ['C'] }, { ...rules, autoMaxClass: 'C' }).outcome,
    ).toBe('auto');
  });

  it('lets the highest class win and flags a spread of two classes', () => {
    const wide: ProgramRules = { ...rules, autoMaxClass: 'C' };
    expect(withInput({ riskClass: 'C', classes: ['A', 'C'] }, wide).reasons).toEqual([
      'CLASS_CONFLICT',
    ]);
    expect(withInput({ riskClass: 'B', classes: ['A', 'B'] }).outcome).toBe('auto');
  });

  it('refers a phrase that is not in the catalogue', () => {
    expect(withInput({ unknownPhrases: 1 }).reasons).toEqual(['UNKNOWN_ACTIVITY']);
    expect(
      withInput({ riskClass: 'A', classes: [], confidence: 0, unknownPhrases: 1 }).reasons,
    ).toEqual(['UNKNOWN_ACTIVITY']);
  });

  it('refers on a possible sanctions match', () => {
    expect(withInput({ screen: { match: true, score: 0.9, entryId: 'sanc_001' } }).reasons).toEqual(
      ['SANCTIONS_POSSIBLE_MATCH'],
    );
  });

  it('always refers degraded extraction', () => {
    expect(withInput({ degraded: true }).reasons).toEqual(['EXTRACTION_FAILED']);
  });

  it('refers when participants or hours are missing', () => {
    expect(withInput({ participants: null }).reasons).toEqual(['MISSING_FACTS']);
    expect(withInput({ hours: null }).reasons).toEqual(['MISSING_FACTS']);
  });

  it('applies the program limits on size and alcohol', () => {
    expect(withInput({ participants: 301 }).reasons).toEqual(['PROGRAM_RULE']);
    expect(withInput({ alcohol: 'served' }, { ...rules, alcoholAuto: false }).reasons).toEqual([
      'PROGRAM_RULE',
    ]);
    expect(withInput({ alcohol: 'sold' }).outcome).toBe('auto');
  });

  it('refers on hazard flags but not on informational ones', () => {
    expect(withInput({ flags: ['fireworks'] }).reasons).toEqual(['PROGRAM_RULE']);
    expect(withInput({ flags: ['overnight', 'weapons'] }).reasons).toEqual(['PROGRAM_RULE']);
    expect(withInput({ flags: ['minors', 'inflatables'] }).outcome).toBe('auto');
  });

  it('lists each reason once, most serious first', () => {
    const d = withInput({
      riskClass: 'X',
      classes: ['A', 'X'],
      degraded: true,
      confidence: 0.3,
      flags: ['fireworks'],
      participants: 900,
      screen: { match: true, score: 0.9, entryId: 's' },
    });
    expect(d.outcome).toBe('refer');
    expect(d.reasons).toEqual([
      'SANCTIONS_POSSIBLE_MATCH',
      'EXCLUDED_ACTIVITY',
      'EXTRACTION_FAILED',
      'CLASS_CONFLICT',
      'LOW_CONFIDENCE',
      'PROGRAM_RULE',
    ]);
  });
});
