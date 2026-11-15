// The shapes the web reads from the API. The vocabulary (classes, reasons, facts, rules) comes straight from the
// API's own contract file; the views below are the JSON of the routes this app calls, written out as a client sees it.
import type {
  AlcoholMode,
  AnswerMap,
  Classification,
  Contacts,
  ConversationState,
  Decision,
  PolicySnapshot,
  PremiumBreakdown,
  ProgramRules,
  ProgramStatus,
  ProgramTerms,
  ProvinceCode,
  QuestionDef,
  QuoteState,
  ReferralReason,
  RiskClass,
  Theme,
} from '../../api/src/domain/types';

export type {
  AlcoholMode,
  AnswerMap,
  Classification,
  Contacts,
  ConversationState,
  Decision,
  PolicySnapshot,
  PremiumBreakdown,
  ProgramRules,
  ProgramStatus,
  ProgramTerms,
  ProvinceCode,
  QuestionDef,
  QuoteState,
  ReferralReason,
  RiskClass,
  Theme,
};

export interface Program {
  id: string;
  code: string;
  name: string;
  province: ProvinceCode;
  brokerId: string;
  brokerName: string;
  terms: ProgramTerms;
  status: ProgramStatus;
  theme: Theme | null;
  contacts: Contacts | null;
}

// One client's last 30 days, as the hub lists it.
export interface ClientSummary {
  program: Pick<Program, 'id' | 'code' | 'name' | 'status' | 'brokerName'>;
  visits: number;
  quotes: number;
  referred: number;
  policies: number;
  premiumCents: number;
  claims: number;
  openReferrals: number;
  oldestOpenAt: string | null;
  daily: { day: string; visits: number; policies: number }[];
}

export interface ChatLine {
  id: string;
  sender: 'renter' | 'bot' | 'staff';
  text: string;
  at: string;
}

export interface Chat {
  id: string;
  state: ConversationState;
  messages: ChatLine[];
}

export interface InboxItem {
  id: string;
  program: { id: string; code: string; name: string };
  channel: 'web' | 'telegram';
  state: ConversationState;
  reason: string | null;
  signedIn: boolean;
  updatedAt: string;
  last: { sender: ChatLine['sender']; text: string } | null;
  lines: number;
}

export interface InboxDetail {
  id: string;
  program: { id: string; code: string; name: string };
  channel: 'web' | 'telegram';
  state: ConversationState;
  signedIn: boolean;
  context: {
    reason?: string;
    handedOverAt?: string;
    policy?: { id: string; policyNumber: string; startsAt: string; endsAt: string };
  };
  createdAt: string;
  messages: ChatLine[];
}

export interface AccessLink {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  action: string;
  detail: Record<string, unknown>;
}

export type Classified = Classification & { decision: Decision };

// A classification read back: the same, with the stored (masked) text.
export type ClassificationView = Classified & { maskedText: string; text: string | null };

export interface Questions {
  prefilled: { id: string; text: string; answer: string | number | boolean }[];
  open: QuestionDef[];
  reasons: ReferralReason[];
}

export interface Quote {
  id: string;
  programId: string;
  state: QuoteState;
  activityId: string;
  classificationId: string | null;
  input: {
    participants: number;
    hours: number;
    alcohol: AlcoholMode;
    eventDate: string;
    startTime: string;
    limitCents: number;
    pricedClass: RiskClass;
    answers: AnswerMap;
  };
  premium: PremiumBreakdown | null;
  holder: { name: string; email: string };
  bookingRef: string | null;
  referralReasons: ReferralReason[];
  createdAt: string;
  expiresAt: string;
}

export interface Policy {
  id: string;
  programId: string;
  quoteId: string;
  policyNumber: string;
  startsAt: string;
  endsAt: string;
  totalCents: number;
  issuedAt: string;
  snapshot: PolicySnapshot;
}

// What was read from a description and stored: the working that the customer and the underwriter both see.
export interface Reading {
  /** With each personal detail as a tag: what the model saw. */
  maskedText: string;
  /** As written, for a key allowed to see personal details; null otherwise. */
  text: string | null;
  facts: Classification['facts'];
  phrases: Classification['phrases'];
  degraded: boolean;
}

export interface WorksheetLine {
  id: string;
  factor: string;
  /** Why this line, and how the amount was worked out, in words. */
  basis: string;
  amountCents: number;
  /** Set when an underwriter changed the amount: what the worksheet proposed. */
  editedFromCents?: number;
  note?: string;
}

export interface Comparable {
  quoteId: string;
  activityTitle: string;
  riskClass: RiskClass;
  participants: number;
  hours: number;
  action: 'approve' | 'approve_with_override' | 'decline';
  totalCents: number | null;
  decidedAt: string;
}

export interface Worksheet {
  lines: WorksheetLine[];
  netTotalCents: number;
  /** The premium the worksheet total produces once the program's loading, fee and tax are applied. */
  proposed: PremiumBreakdown;
  comparables: Comparable[];
}

export interface Referral {
  id: string;
  quoteId: string;
  programId: string;
  state: 'open' | 'claimed' | 'decided';
  reasons: ReferralReason[];
  claimedBy: string | null;
  dueAt: string;
  createdAt: string;
  decidedAt: string | null;
  /** null once decided. */
  sla: 'ok' | 'due_soon' | 'overdue' | null;
  decision: {
    action: 'approve' | 'approve_with_override' | 'decline';
    riskClass: RiskClass | null;
    note: string;
    worksheet: WorksheetLine[] | null;
  } | null;
  activity: { id: string; title: string; riskClass: RiskClass };
  quote: Quote;
}

export type ReferralDetail = Referral & { classification: (Reading & { id: string }) | null };

export interface ProgramDetail extends Omit<Program, 'brokerName'> {
  rules: ProgramRules;
  versions: { version: number; effectiveFrom: string }[];
}

export type RulesChanges = Partial<ProgramRules>;

export interface RulesDraft {
  changes: RulesChanges;
  notes: { field: keyof ProgramRules; from: unknown; to: unknown }[];
  /** What the text asked for that could not become a rule: a person has to look. */
  unresolved: string[];
  degraded: boolean;
  /** Names for the activity ids the changes mention (added by the web, not the API). */
  titles?: Record<string, string>;
}

export interface RulesPreview {
  summary: {
    examined: number;
    unchanged: number;
    nowAuto: number;
    nowRefer: number;
    reasonsChanged: number;
  };
  changed: {
    quoteId: string;
    activityTitle: string;
    participants: number;
    before: Decision;
    after: Decision;
  }[];
}

export interface ProgramOptions {
  templates: { id: string; terms: ProgramTerms; rules: ProgramRules }[];
  brokers: { id: string; name: string }[];
}

export { PROVINCES } from '../../api/src/domain/types';

export interface PolicyTotals {
  policies: number;
  grossCents: number;
  taxCents: number;
  commissionCents: number;
  netCents: number;
}

export interface PolicyReport {
  period: string;
  program: { id: string; code: string; name: string } | null;
  summary: {
    byLimit: (PolicyTotals & { limitCents: number })[];
    total: PolicyTotals & { feeCents: number; totalCents: number };
  };
  lines: {
    policyNumber: string;
    program: string;
    issuedOn: string;
    eventDate: string;
    venue: string;
    activity: string;
    participants: number;
    limitCents: number;
    totalCents: number;
  }[];
}

export type ReconException =
  | { kind: 'charge_without_policy'; paymentId: string; reference: string; amountCents: number }
  | { kind: 'duplicate_charge'; policyNumber: string; charges: number; chargedCents: number }
  | { kind: 'amount_mismatch'; policyNumber: string; expectedCents: number; chargedCents: number }
  | { kind: 'policy_without_charge'; policyNumber: string; expectedCents: number };

export interface ReconReport {
  rows: {
    programId: string;
    code: string;
    name: string;
    broker: string;
    policies: number;
    totalCents: number;
    grossCents: number;
    commissionCents: number;
    commissionRate: number;
    carrierCents: number;
    taxCents: number;
    retainedCents: number;
    mgaPaysBrokerCents: number;
    brokerPaysMgaCents: number;
  }[];
  exceptions: ReconException[];
}

export interface Metric {
  value: number | null;
  low: number;
  high: number;
  successes: number;
  n: number;
}

// The committed privacy evaluation (evals/privacy.json): invented descriptions with personal details planted in them,
// protected by cue rules alone and with the names model; every planted value left in the text is one the model would see.
export interface PrivacyDetector {
  id: 'rules' | 'model';
  planted: Record<string, number>;
  leaked: Record<string, number>;
  plantedTotal: number;
  leakedTotal: number;
  goldenChanged: number;
  p50Ms: number;
  p95Ms: number;
  examples: string[];
}
export interface PrivacyEval {
  measuredOn: string;
  texts: number;
  goldenCases: number;
  detectors: PrivacyDetector[];
}
// What the running server says: what finds names, and what the guard on the model has seen since it started.
export interface PrivacyLive {
  names: 'model' | 'rules';
  guard: { calls: number; stripped: number };
}

// One committed evaluation: the golden set judged with one model and one embedder (evals/results/*.json).
export interface EvalResult {
  label: string;
  date: string;
  summary: {
    n: number;
    top1: Metric;
    classAccuracy: Metric;
    outcomeAccuracy: Metric;
    referralRecall: Metric;
    referralPrecision: Metric;
    automaticRate: Metric;
    unsafeAutomation: number;
    latencyMs: { p50: number; p95: number };
    byTag: Record<string, { n: number; top1: Metric; outcomeAccuracy: Metric }>;
  };
  sweep: {
    autoConfidenceMin: number;
    automaticRate: number | null;
    unsafeAutomation: number;
    outcomeAccuracy: number | null;
    referralPrecision: number | null;
  }[];
}

export interface ShadowReport {
  since: string;
  decided: number;
  replayed: number;
  skipped: number;
  agreement: Metric;
  automaticRate: Metric;
  counts: Record<
    'automation_agrees' | 'human_needed' | 'rubber_stamp' | 'automation_unsafe',
    number
  >;
  disagreements: {
    referralId: string;
    quoteId: string;
    text: string;
    human: { action: string; edited: boolean };
    system: { outcome: 'auto' | 'refer'; reasons: ReferralReason[] };
    verdict: 'automation_agrees' | 'human_needed' | 'rubber_stamp' | 'automation_unsafe';
  }[];
}
