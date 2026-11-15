import type { ProgramRules, ProgramTerms } from '../../domain/types.js';
import { STANDARD_QUESTIONS } from '../questions/index.js';

// Starting points for a new client program. The values are invented; a real catalogue of templates would be data
// that the business edits.
export interface ProgramTemplate {
  terms: ProgramTerms;
  rules: ProgramRules;
}

export const TEMPLATES: Record<string, ProgramTemplate> = {
  municipal: {
    terms: { loadingBps: 4500, commissionBps: 1500, feeCents: 350 },
    rules: {
      autoConfidenceMin: 0.8,
      autoMaxClass: 'B',
      maxParticipantsAuto: 300,
      alcoholAuto: true,
      excludedActivityIds: [],
      limitsCents: [200_000_000, 500_000_000],
      questions: STANDARD_QUESTIONS,
    },
  },
  school_board: {
    terms: { loadingBps: 4200, commissionBps: 1200, feeCents: 300 },
    rules: {
      autoConfidenceMin: 0.85,
      autoMaxClass: 'B',
      maxParticipantsAuto: 200,
      alcoholAuto: false,
      excludedActivityIds: [],
      limitsCents: [200_000_000],
      questions: STANDARD_QUESTIONS,
    },
  },
  community_hall: {
    terms: { loadingBps: 4800, commissionBps: 1800, feeCents: 400 },
    rules: {
      autoConfidenceMin: 0.8,
      autoMaxClass: 'C',
      maxParticipantsAuto: 500,
      alcoholAuto: true,
      excludedActivityIds: [],
      limitsCents: [200_000_000, 500_000_000],
      questions: STANDARD_QUESTIONS,
    },
  },
};
