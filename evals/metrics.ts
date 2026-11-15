import { type Metric, proportion, wilson } from '../apps/api/src/domain/stats.js';
import type { ReferralReason, RiskClass } from '../apps/api/src/domain/types.js';
import type { Outcome, Tag } from './golden.js';

export { type Metric, proportion, wilson };

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] as number;
}

export interface CaseResult {
  id: string;
  text: string;
  tags: Tag[];
  expected: { title: string | null; riskClass: RiskClass | null; outcome: Outcome };
  got: {
    title: string | null;
    riskClass: RiskClass | null;
    outcome: Outcome;
    reasons: ReferralReason[];
    degraded: boolean;
    confidence: number;
  };
  latencyMs: number;
}

export interface Summary {
  n: number;
  top1: Metric;
  classAccuracy: Metric;
  outcomeAccuracy: Metric;
  /** Of the cases that should be referred, the share that were. The number to keep at 100%. */
  referralRecall: Metric;
  /** Of the cases the system referred, the share that needed it. The cost of caution. */
  referralPrecision: Metric;
  automaticRate: Metric;
  /** Cases that should have been referred but were priced automatically. */
  unsafeAutomation: number;
  latencyMs: { p50: number; p95: number };
  byTag: Record<string, { n: number; top1: Metric; outcomeAccuracy: Metric }>;
}

const isTop1 = (r: CaseResult) => r.got.title === r.expected.title;

export function summarize(results: CaseResult[]): Summary {
  const withTitle = results.filter((r) => r.expected.title !== null);
  const shouldRefer = results.filter((r) => r.expected.outcome === 'refer');
  const referred = results.filter((r) => r.got.outcome === 'refer');
  const byTag: Summary['byTag'] = {};
  for (const tag of new Set(results.flatMap((r) => r.tags))) {
    const group = results.filter((r) => r.tags.includes(tag));
    const titled = group.filter((r) => r.expected.title !== null);
    byTag[tag] = {
      n: group.length,
      top1: proportion(titled.filter(isTop1).length, titled.length),
      outcomeAccuracy: proportion(
        group.filter((r) => r.got.outcome === r.expected.outcome).length,
        group.length,
      ),
    };
  }
  return {
    n: results.length,
    top1: proportion(withTitle.filter(isTop1).length, withTitle.length),
    classAccuracy: proportion(
      results.filter((r) => r.got.riskClass === r.expected.riskClass).length,
      results.length,
    ),
    outcomeAccuracy: proportion(
      results.filter((r) => r.got.outcome === r.expected.outcome).length,
      results.length,
    ),
    referralRecall: proportion(
      shouldRefer.filter((r) => r.got.outcome === 'refer').length,
      shouldRefer.length,
    ),
    referralPrecision: proportion(
      referred.filter((r) => r.expected.outcome === 'refer').length,
      referred.length,
    ),
    automaticRate: proportion(
      results.filter((r) => r.got.outcome === 'auto').length,
      results.length,
    ),
    unsafeAutomation: shouldRefer.filter((r) => r.got.outcome === 'auto').length,
    latencyMs: {
      p50: percentile(
        results.map((r) => r.latencyMs),
        0.5,
      ),
      p95: percentile(
        results.map((r) => r.latencyMs),
        0.95,
      ),
    },
    byTag,
  };
}
