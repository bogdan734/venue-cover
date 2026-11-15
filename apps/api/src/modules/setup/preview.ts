import type { Kysely } from 'kysely';
import type { Database } from '../../db/types.js';
import type { Decision } from '../../domain/types.js';
import { getProgramRules, type ProgramRulesChangeSet, resolveRules } from '../programs/index.js';
import { decisionInput, quotesForPreview } from '../quotes/index.js';
import { decide } from '../underwriting/index.js';

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

const NO_SCREEN = { match: false, score: 0, entryId: null };

// Tries a rule change on the program's recent quotes without touching anything: which of them would have gone
// another way. Name screening does not depend on the rules, so it is left out of both sides.
export async function previewRules(
  db: Kysely<Database>,
  programId: string,
  changes: ProgramRulesChangeSet,
  sample: number,
  now: Date,
): Promise<RulesPreview> {
  const current = await getProgramRules(db, programId, now.toISOString().slice(0, 10));
  const proposed = resolveRules(current, changes);
  const quotes = await quotesForPreview(db, programId, sample);

  const changed: RulesPreview['changed'] = [];
  const summary = {
    examined: quotes.length,
    unchanged: 0,
    nowAuto: 0,
    nowRefer: 0,
    reasonsChanged: 0,
  };
  for (const q of quotes) {
    const input = decisionInput(q.activity, q.input, q.classification, NO_SCREEN);
    const before = decide(input, current);
    const after = decide(input, proposed);
    if (before.outcome === after.outcome && before.reasons.join() === after.reasons.join()) {
      summary.unchanged++;
      continue;
    }
    if (before.outcome !== after.outcome) {
      if (after.outcome === 'auto') summary.nowAuto++;
      else summary.nowRefer++;
    } else {
      summary.reasonsChanged++;
    }
    changed.push({
      quoteId: q.quoteId,
      activityTitle: q.activity.title,
      participants: q.input.participants,
      before,
      after,
    });
  }
  return { summary, changed };
}
