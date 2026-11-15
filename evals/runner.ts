import { performance } from 'node:perf_hooks';
import type { Kysely } from 'kysely';
import type { Database } from '../apps/api/src/db/types.js';
import type { Classification, ProgramRules } from '../apps/api/src/domain/types.js';
import type { Embedder } from '../apps/api/src/modules/catalogue/index.js';
import {
  classifyEvent,
  type LlmProvider,
  type Recording,
} from '../apps/api/src/modules/intake/index.js';
import { createShield } from '../apps/api/src/modules/privacy/index.js';
import { decide, inputFromClassification } from '../apps/api/src/modules/underwriting/index.js';
import type { GoldenCase } from './golden.js';
import { type CaseResult, summarize } from './metrics.js';

// The rules every case is judged against: automatic up to class B, 300 people, alcohol allowed.
export const REFERENCE_RULES: ProgramRules = {
  autoConfidenceMin: 0.8,
  autoMaxClass: 'B',
  maxParticipantsAuto: 300,
  alcoholAuto: true,
  excludedActivityIds: [],
  limitsCents: [200_000_000, 500_000_000],
  questions: [],
};

// What a report or a baseline built on a recording is called.
export const recordingLabel = (recording: Recording): string =>
  `replay-${recording.model.replace(/[^\w.-]+/g, '-')}`;

export interface EvalDeps {
  db: Kysely<Database>;
  llm: LlmProvider;
  embedder: Embedder;
  /** A program that exists in `db`; classifications are stored against it. */
  programId?: string;
}

export interface Classified {
  golden: GoldenCase;
  classification: Classification;
  latencyMs: number;
}

export interface EvalReport {
  provider: string;
  summary: ReturnType<typeof summarize>;
  results: CaseResult[];
}

// The golden set holds nothing personal (a test checks the shield leaves it unchanged), so the rules are enough here and
// the tags need only be stable within a run.
export const EVAL_SHIELD = createShield({ secret: 'evaluation runs: tags need only be stable' });

// Runs each description through the same code path as production (protection, extraction and matching), one at a time
// so that latency means something. Judging against rules is a separate, cheap step, so rules can be swept without new model calls.
export async function classifyCases(
  cases: readonly GoldenCase[],
  deps: EvalDeps,
): Promise<Classified[]> {
  const out: Classified[] = [];
  for (const golden of cases) {
    const started = performance.now();
    const classification = await classifyEvent(
      { ...deps, shield: EVAL_SHIELD },
      {
        text: golden.text,
        programId: deps.programId ?? 'prg_1',
      },
    );
    out.push({ golden, classification, latencyMs: performance.now() - started });
  }
  return out;
}

export function judge(classified: Classified[], rules: ProgramRules, provider: string): EvalReport {
  const results: CaseResult[] = classified.map(({ golden, classification, latencyMs }) => {
    const decision = decide(
      inputFromClassification(classification, { match: false, score: 0, entryId: null }),
      rules,
    );
    return {
      id: golden.id,
      text: golden.text,
      tags: golden.tags,
      expected: { title: golden.title, riskClass: golden.riskClass, outcome: golden.outcome },
      got: {
        title: classification.primary?.title ?? null,
        riskClass: classification.riskClass,
        outcome: decision.outcome,
        reasons: decision.reasons,
        degraded: classification.degraded,
        confidence: classification.confidence,
      },
      latencyMs,
    };
  });
  return { provider, summary: summarize(results), results };
}

export async function runEval(
  cases: readonly GoldenCase[],
  deps: EvalDeps,
  provider: string,
): Promise<EvalReport> {
  return judge(await classifyCases(cases, deps), REFERENCE_RULES, provider);
}

// What the automatic-decision threshold costs and buys: for each value, how much is priced without a person, how much
// of that was safe, and how many referrals were needless.
export function sweepConfidence(classified: Classified[], values: number[]) {
  return values.map((autoConfidenceMin) => {
    const s = judge(classified, { ...REFERENCE_RULES, autoConfidenceMin }, 'sweep').summary;
    return {
      autoConfidenceMin,
      automaticRate: s.automaticRate.value,
      unsafeAutomation: s.unsafeAutomation,
      outcomeAccuracy: s.outcomeAccuracy.value,
      referralPrecision: s.referralPrecision.value,
    };
  });
}
