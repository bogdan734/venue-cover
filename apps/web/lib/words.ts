import type { Tone } from '@/components/ui/badge';
import { count, limitShort } from './format';
import type {
  AlcoholMode,
  ConversationState,
  ProgramRules,
  ProgramStatus,
  ProvinceCode,
  ReferralReason,
} from './types';

// The codes the API speaks, in words a customer or an underwriter reads. One place, so the two sides agree.

export const REASONS: Record<ReferralReason, { title: string; detail: string }> = {
  SANCTIONS_POSSIBLE_MATCH: {
    title: 'Name screening',
    detail: 'The name is close to an entry on a screening list, so a person confirms who it is.',
  },
  EXCLUDED_ACTIVITY: {
    title: 'Not covered without review',
    detail: 'This activity is outside what the program insures automatically.',
  },
  EXTRACTION_FAILED: {
    title: 'The description was read two ways',
    detail:
      'The model and the plain rules disagreed about the facts, so the stricter reading was used and a person checks it.',
  },
  UNKNOWN_ACTIVITY: {
    title: 'Something we could not place',
    detail: 'Part of the description matches nothing in the catalogue.',
  },
  CLASS_CONFLICT: {
    title: 'Very different activities together',
    detail:
      'The activities named sit far apart in risk, so one price for all of them needs a look.',
  },
  MISSING_FACTS: {
    title: 'Something is missing',
    detail: 'A fact the price depends on, or an answer the program asks for, was not given.',
  },
  LOW_CONFIDENCE: {
    title: 'Not sure enough of the activity',
    detail: 'The closest catalogue entry is not close enough for this program to price it unseen.',
  },
  OVER_CAPACITY: {
    title: 'A larger crowd than the rate card covers',
    detail: 'The number of people is beyond the largest band on the rate card.',
  },
  NO_RATE: {
    title: 'No rate for this combination',
    detail: 'The rate card has no row for this activity, limit and alcohol service together.',
  },
  PROGRAM_RULE: {
    title: 'A program rule asks for a person',
    detail:
      'The risk class, the size of the crowd, alcohol service, a hazard or an answer is one this program does not price automatically.',
  },
};

export const ALCOHOL: Record<AlcoholMode, string> = {
  none: 'No alcohol',
  served: 'Alcohol served',
  sold: 'Alcohol sold',
};

export const FLAGS: Record<string, string> = {
  fireworks: 'fireworks',
  overnight: 'overnight stay',
  weapons: 'weapons',
  motorized: 'motor vehicles',
  minors: 'children taking part',
  inflatables: 'inflatables',
  animals: 'animals',
};

export const flagWord = (flag: string): string => FLAGS[flag] ?? flag.replaceAll('_', ' ');

// What a program prices without a person, as one sentence each.
export function rulesInWords(rules: ProgramRules): string[] {
  return [
    `Risk class ${rules.autoMaxClass === 'A' ? 'A only' : `A to ${rules.autoMaxClass}`}`,
    `Up to ${count(rules.maxParticipantsAuto)} people`,
    rules.alcoholAuto ? 'Alcohol allowed' : 'Alcohol needs a person',
    `Limits offered: ${rules.limitsCents.map(limitShort).join(', ')}`,
  ];
}

// A province or territory by name: a renter knows where the hall is, not its code.
export const PROVINCE: Record<ProvinceCode, string> = {
  AB: 'Alberta',
  BC: 'British Columbia',
  MB: 'Manitoba',
  NB: 'New Brunswick',
  NL: 'Newfoundland and Labrador',
  NS: 'Nova Scotia',
  NT: 'Northwest Territories',
  NU: 'Nunavut',
  ON: 'Ontario',
  PE: 'Prince Edward Island',
  QC: 'Quebec',
  SK: 'Saskatchewan',
  YT: 'Yukon',
};

// Where a client program is in its life, and what that means for its portal.
export const STATUS: Record<ProgramStatus, { word: string; tone: Tone; portal: string }> = {
  draft: { word: 'Draft', tone: 'neutral', portal: 'only staff can see the portal' },
  test: { word: 'In test', tone: 'info', portal: 'only staff can see the portal' },
  live: { word: 'Live', tone: 'ok', portal: 'the portal is public' },
  paused: { word: 'Paused', tone: 'warn', portal: 'the portal is visible but takes no new quotes' },
};

// A conversation in the staff inbox: who has it, and why the assistant handed it over.
export const CHAT_STATE: Record<ConversationState, { word: string; tone: Tone }> = {
  waiting: { word: 'Waiting', tone: 'warn' },
  human: { word: 'With a person', tone: 'info' },
  bot: { word: 'Assistant', tone: 'neutral' },
  closed: { word: 'Closed', tone: 'neutral' },
};

export const HANDOVER: Record<string, string> = {
  claim: 'Claim reported',
  human: 'Asked for a person',
  refund: 'Cancellation or refund',
  other: 'The assistant could not answer',
};
