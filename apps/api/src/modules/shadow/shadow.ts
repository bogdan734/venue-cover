import type { Kysely } from 'kysely';
import type { Database } from '../../db/types.js';
import { type Metric, proportion } from '../../domain/stats.js';
import type { ReferralReason } from '../../domain/types.js';
import type { Embedder } from '../catalogue/index.js';
import { interpretEvent, type LlmProvider } from '../intake/index.js';
import { getProgramRules } from '../programs/index.js';
import { type DecidedReferral, decidedReferralsSince } from '../quotes/index.js';
import { decide, inputFromClassification } from '../underwriting/index.js';

// What the system would have done with a referral that a person decided, set against what the person did:
//   automation_agrees  the system would price it by itself, and the person approved it as it was
//   human_needed       the system would refer it again, and the person did change or refuse it
//   rubber_stamp       the system would refer it again, and the person approved it as it was (a person was not needed)
//   automation_unsafe  the system would price it by itself, and the person declined or changed it
export type Verdict = 'automation_agrees' | 'human_needed' | 'rubber_stamp' | 'automation_unsafe';

export function verdictOf(outcome: 'auto' | 'refer', human: DecidedReferral['decision']): Verdict {
  const changed = human.action !== 'approve' || human.edited;
  if (outcome === 'auto') return changed ? 'automation_unsafe' : 'automation_agrees';
  return changed ? 'human_needed' : 'rubber_stamp';
}

export interface ShadowCase {
  referralId: string;
  quoteId: string;
  text: string;
  human: DecidedReferral['decision'];
  system: { outcome: 'auto' | 'refer'; reasons: ReferralReason[] };
  verdict: Verdict;
}

export interface ShadowReport {
  since: string;
  /** Referrals decided since then. */
  decided: number;
  replayed: number;
  /** Quotes that were not made from a description have nothing to replay. */
  skipped: number;
  /** The share of replayed referrals where the system's routing matched what the person's decision showed was right. */
  agreement: Metric;
  /** The share the system would now price without a person. */
  automaticRate: Metric;
  counts: Record<Verdict, number>;
  /** Unsafe automation first, then the referrals a person did not need. */
  disagreements: ShadowCase[];
}

export interface ShadowDeps {
  db: Kysely<Database>;
  llm: LlmProvider;
  embedder: Embedder;
  /** Picks the rules in force. */
  now: Date;
}

// Reruns the classifier and the program rules on the description of every referral decided since `since`, without
// storing anything, and compares the outcome with the human decision. Pointing `llm` or `embedder` at a candidate
// shows what switching to it would do to the people who check the work today.
export async function replay(deps: ShadowDeps, since: Date): Promise<ShadowReport> {
  const decided = await decidedReferralsSince(deps.db, since);
  const today = deps.now.toISOString().slice(0, 10);
  const rulesOf = new Map<string, ReturnType<typeof getProgramRules>>();

  const cases: ShadowCase[] = [];
  for (const referral of decided) {
    if (referral.text === null) continue;
    const rules =
      rulesOf.get(referral.programId) ?? getProgramRules(deps.db, referral.programId, today);
    rulesOf.set(referral.programId, rules);
    const classification = await interpretEvent(deps, {
      text: referral.text,
      programId: referral.programId,
    });
    const decision = decide(
      inputFromClassification(classification, { match: false, score: 0, entryId: null }),
      await rules,
    );
    cases.push({
      referralId: referral.referralId,
      quoteId: referral.quoteId,
      text: referral.text,
      human: referral.decision,
      system: { outcome: decision.outcome, reasons: decision.reasons },
      verdict: verdictOf(decision.outcome, referral.decision),
    });
  }

  const counts: Record<Verdict, number> = {
    automation_agrees: 0,
    human_needed: 0,
    rubber_stamp: 0,
    automation_unsafe: 0,
  };
  for (const c of cases) counts[c.verdict] += 1;
  const rank = (c: ShadowCase) =>
    c.verdict === 'automation_unsafe' ? 0 : c.verdict === 'rubber_stamp' ? 1 : 2;
  return {
    since: since.toISOString(),
    decided: decided.length,
    replayed: cases.length,
    skipped: decided.length - cases.length,
    agreement: proportion(counts.automation_agrees + counts.human_needed, cases.length),
    automaticRate: proportion(
      cases.filter((c) => c.system.outcome === 'auto').length,
      cases.length,
    ),
    counts,
    disagreements: cases.filter((c) => rank(c) < 2).sort((a, b) => rank(a) - rank(b)),
  };
}
