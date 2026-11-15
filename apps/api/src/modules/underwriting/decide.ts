import type {
  AlcoholMode,
  Classification,
  Decision,
  EventFlag,
  ProgramRules,
  ReferralReason,
  RiskClass,
  ScreeningResult,
} from '../../domain/types.js';

export interface DecisionInput {
  /** Highest class among the activities; null when none matched. */
  riskClass: RiskClass | null;
  /** Class of every matched activity, to spot a mixed-risk event. */
  classes: RiskClass[];
  /** The matched activities, to apply a program's exclusions. */
  activityIds: string[];
  /** Weakest best-match score; 1 when the customer chose the activity from the catalogue. */
  confidence: number;
  /** Phrases that matched nothing in the catalogue. */
  unknownPhrases: number;
  degraded: boolean;
  flags: EventFlag[];
  participants: number | null;
  hours: number | null;
  alcohol: AlcoholMode | null;
  screen: ScreeningResult;
}

const CLASS_RANK: Record<RiskClass, number> = { A: 0, B: 1, C: 2, X: 3 };
const HAZARD_FLAGS: readonly EventFlag[] = ['fireworks', 'overnight', 'weapons', 'motorized'];

// Reasons come out most serious first, so the underwriter reads the worst problem at the top.
const SEVERITY: readonly ReferralReason[] = [
  'SANCTIONS_POSSIBLE_MATCH',
  'EXCLUDED_ACTIVITY',
  'EXTRACTION_FAILED',
  'UNKNOWN_ACTIVITY',
  'CLASS_CONFLICT',
  'MISSING_FACTS',
  'LOW_CONFIDENCE',
  'OVER_CAPACITY',
  'NO_RATE',
  'PROGRAM_RULE',
];

// Pure. A quote is priced and issued automatically only when nothing below fires; every trigger needs a person.
export function decide(input: DecisionInput, rules: ProgramRules): Decision {
  const found = new Set<ReferralReason>();

  if (input.screen.match) found.add('SANCTIONS_POSSIBLE_MATCH');
  if (input.classes.includes('X') || input.riskClass === 'X') found.add('EXCLUDED_ACTIVITY');
  if (input.activityIds.some((id) => rules.excludedActivityIds.includes(id)))
    found.add('EXCLUDED_ACTIVITY');
  if (input.degraded) found.add('EXTRACTION_FAILED');
  if (input.unknownPhrases > 0) found.add('UNKNOWN_ACTIVITY');
  else if (input.confidence < rules.autoConfidenceMin) found.add('LOW_CONFIDENCE');

  const ranks = input.classes.map((c) => CLASS_RANK[c]);
  if (ranks.length > 1 && Math.max(...ranks) - Math.min(...ranks) >= 2) found.add('CLASS_CONFLICT');

  if (input.participants === null || input.hours === null || input.alcohol === null)
    found.add('MISSING_FACTS');

  if (
    input.riskClass &&
    input.riskClass !== 'X' &&
    CLASS_RANK[input.riskClass] > CLASS_RANK[rules.autoMaxClass]
  ) {
    found.add('PROGRAM_RULE');
  }
  if (input.participants !== null && input.participants > rules.maxParticipantsAuto)
    found.add('PROGRAM_RULE');
  if (input.alcohol !== null && input.alcohol !== 'none' && !rules.alcoholAuto)
    found.add('PROGRAM_RULE');
  if (input.flags.some((flag) => HAZARD_FLAGS.includes(flag))) found.add('PROGRAM_RULE');

  const reasons = sortReasons([...found]);
  return { outcome: reasons.length === 0 ? 'auto' : 'refer', reasons };
}

export function sortReasons(reasons: ReferralReason[]): ReferralReason[] {
  return SEVERITY.filter((reason) => reasons.includes(reason));
}

// What the description alone says, before the customer confirms anything or a name is screened.
export function inputFromClassification(c: Classification, screen: ScreeningResult): DecisionInput {
  const accepted = c.phrases.flatMap((p) => (p.accepted ? [p.accepted] : []));
  return {
    riskClass: c.riskClass,
    classes: accepted.map((a) => a.riskClass),
    activityIds: accepted.map((a) => a.activityId),
    confidence: c.confidence,
    unknownPhrases: c.phrases.length === 0 ? 1 : c.phrases.length - accepted.length,
    degraded: c.degraded,
    flags: c.facts.flags,
    participants: c.facts.participants,
    hours: c.facts.hours,
    alcohol: c.facts.alcohol,
    screen,
  };
}
