// Contracts shared by modules, the seed data and the tests. Money is always integer cents.
export type Cents = number;

export type RiskClass = 'A' | 'B' | 'C' | 'X';
export type PricedRiskClass = Exclude<RiskClass, 'X'>;

export type AlcoholMode = 'none' | 'served' | 'sold';

export const PROVINCES = [
  'AB',
  'BC',
  'MB',
  'NB',
  'NL',
  'NS',
  'NT',
  'NU',
  'ON',
  'PE',
  'QC',
  'SK',
  'YT',
] as const;
export type ProvinceCode = (typeof PROVINCES)[number];

// Draft and test portals are seen by staff only; a paused program takes no new business.
export const PROGRAM_STATUSES = ['draft', 'test', 'live', 'paused'] as const;
export type ProgramStatus = (typeof PROGRAM_STATUSES)[number];

// How a program's portal looks. Data, not markup: the portal decides where each piece goes.
export interface Theme {
  /** `#rrggbb`, readable as white text on it and as link colour on the page. */
  brand: string;
  /** An image held in the page itself (`data:image/...;base64,`), or none. */
  logo: string | null;
  tagline: string | null;
  welcome: string | null;
}

// Who is answering a conversation: the bot, nobody yet (handed over), a person, or nobody because it is finished.
export type ConversationState = 'bot' | 'waiting' | 'human' | 'closed';

// Who a program's renters can reach. The program's own business contacts, not a person's.
export interface Contacts {
  supportEmail: string | null;
  supportPhone: string | null;
  telegram: string | null;
  hours: string | null;
}

export type QuoteState = 'quoted' | 'referred' | 'declined' | 'bound' | 'issued' | 'expired';

// Program-level loads on top of the net (carrier) premium, in basis points of the gross premium.
export interface ProgramTerms {
  loadingBps: number;
  commissionBps: number;
  feeCents: Cents;
}

// Thresholds a program sets for automatic decisions.
export interface ProgramRules {
  autoConfidenceMin: number;
  autoMaxClass: PricedRiskClass;
  maxParticipantsAuto: number;
  alcoholAuto: boolean;
  /** Activities this program never prices on its own, whatever their class. */
  excludedActivityIds: string[];
  /** The liability limits the program offers. */
  limitsCents: Cents[];
  /** The questions this program asks beyond the basics, as data. */
  questions: QuestionDef[];
}

// One priced quote. Invariant: net + commission + margin + fee + tax = total.
export interface PremiumBreakdown {
  netCents: Cents;
  commissionCents: Cents;
  marginCents: Cents;
  feeCents: Cents;
  taxCents: Cents;
  totalCents: Cents;
  rateRowId: string;
}

export const SCOPES = [
  'quotes:read',
  'quotes:write',
  'referrals:decide',
  'webhooks:manage',
  'reports:read',
  'programs:manage',
  'mail:read',
  // Personal details as written. A key for an AI agent is made without it and sees tags only.
  'personal:read',
  // The staff inbox: read every conversation, reply, take over and close.
  'conversations:manage',
] as const;
export type Scope = (typeof SCOPES)[number];

export const EVENT_TYPES = [
  'quote.created',
  'quote.referred',
  'referral.decided',
  'policy.issued',
  'certificate.ready',
  'certificate.unrouted',
  'claim.reported',
  'program.rules_published',
  'webhook.delivery.failed',
  'webhook.test',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

// Webhooks never carry delivery failures: a failing endpoint must not trigger more deliveries to itself. A test event goes
// to the one endpoint it was sent to, so nothing subscribes to it.
export const DELIVERABLE_EVENT_TYPES = EVENT_TYPES.filter(
  (t): t is Exclude<EventType, 'webhook.delivery.failed' | 'webhook.test'> =>
    t !== 'webhook.delivery.failed' && t !== 'webhook.test',
);

export type ReferralReason =
  | 'LOW_CONFIDENCE'
  | 'UNKNOWN_ACTIVITY'
  | 'EXCLUDED_ACTIVITY'
  | 'CLASS_CONFLICT'
  | 'OVER_CAPACITY'
  | 'NO_RATE'
  | 'SANCTIONS_POSSIBLE_MATCH'
  | 'PROGRAM_RULE'
  | 'EXTRACTION_FAILED'
  | 'MISSING_FACTS';

export const EVENT_FLAGS = [
  'fireworks',
  'overnight',
  'animals',
  'inflatables',
  'minors',
  'weapons',
  'motorized',
] as const;
export type EventFlag = (typeof EVENT_FLAGS)[number];

// What a customer's free-text description says about the event; null means "not stated".
export interface EventFacts {
  activities: string[];
  participants: number | null;
  hours: number | null;
  alcohol: AlcoholMode | null;
  flags: EventFlag[];
}

export interface ActivityMatch {
  activityId: string;
  title: string;
  riskClass: RiskClass;
  score: number;
  phrase: string;
}

// The best catalogue candidates for one phrase of the description; `accepted` is the top one when it clears the floor.
export interface PhraseMatch {
  phrase: string;
  candidates: ActivityMatch[];
  accepted: ActivityMatch | null;
}

export interface Classification {
  id: string;
  programId: string;
  facts: EventFacts;
  phrases: PhraseMatch[];
  /** The highest class among the accepted matches, or null when nothing matched. */
  riskClass: RiskClass | null;
  /** The accepted match that prices the event: highest class, then highest score. */
  primary: ActivityMatch | null;
  /** The weakest best-match score over the phrases (0 when there are none). */
  confidence: number;
  degraded: boolean;
}

export interface ScreeningResult {
  match: boolean;
  score: number;
  entryId: string | null;
}

export interface Decision {
  outcome: 'auto' | 'refer';
  reasons: ReferralReason[];
}

export interface Contact {
  name: string;
  email: string;
}

// Everything a certificate needs, frozen when the policy is issued so that later edits cannot change a document.
export interface PolicySnapshot {
  holder: Contact;
  programName: string;
  activityTitle: string;
  venue: { id: string; name: string } | null;
  bookingRef: string | null;
  limitCents: Cents;
  participants: number;
  hours: number;
  alcohol: AlcoholMode;
  premium: PremiumBreakdown;
  /** Null when the booking reference did not identify a rental: those parties get no certificate. */
  recipients: { venue: Contact | null; broker: Contact | null };
  routed: boolean;
}

export type Answer = string | number | boolean;
export type AnswerMap = Record<string, Answer>;

// When a question applies. Combinators nest, so a program can say "alcohol served and more than 250 people".
export type Condition =
  | { always: true }
  | { flag: EventFlag }
  | { alcohol: AlcoholMode[] }
  | { productCode: string[] }
  | { riskClass: RiskClass[] }
  | { minParticipants: number }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

export interface QuestionDef {
  id: string;
  text: string;
  type: 'yesno' | 'number' | 'choice';
  choices?: string[];
  appliesWhen: Condition;
  /** An answer that sends the quote to an underwriter. */
  referIf?: { equals?: Answer; atLeast?: number; atMost?: number };
  /** Answer it from what the description already says instead of asking. */
  answerFrom?: 'participants' | 'hours';
}

export type VendorType =
  | 'food'
  | 'liquor'
  | 'performer'
  | 'retail'
  | 'animal'
  | 'carnival'
  | 'dunk_tank'
  | 'inflatable'
  | 'security';

// What a large-event application tells us beyond a quote's basics; stored with the quote for the underwriter's worksheet.
export interface QuoteDetails {
  dailyPeak?: number;
  vendors?: Partial<Record<VendorType, number>>;
  temporarySeats?: number | null;
  priorClaims?: boolean | null;
  serverTraining?: boolean | null;
  flags?: EventFlag[];
}
