import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generate } from '../../../data/generate.js';
import { GOLDEN, type Tag } from '../../../evals/golden.js';
import {
  type CaseResult,
  percentile,
  proportion,
  summarize,
  wilson,
} from '../../../evals/metrics.js';
import { renderReport } from '../../../evals/report.js';
import {
  classifyCases,
  judge,
  REFERENCE_RULES,
  recordingLabel,
  runEval,
  sweepConfidence,
} from '../../../evals/runner.js';
import { seedDatabase } from '../src/db/seed.js';
import {
  createLexicalEmbedder,
  createTransformersEmbedder,
  type Embedder,
  embedCatalogue,
  isModelCached,
} from '../src/modules/catalogue/index.js';
import {
  createKeywordLlm,
  createRecordedLlm,
  type Recording,
} from '../src/modules/intake/index.js';
import { createTestDb, type TestDb } from './db.js';

describe('wilson interval', () => {
  it('matches reference values', () => {
    const [low, high] = wilson(80, 100);
    expect(low).toBeCloseTo(0.7112, 3);
    expect(high).toBeCloseTo(0.8666, 3);
    const [zeroLow, zeroHigh] = wilson(0, 10);
    expect(zeroLow).toBe(0);
    expect(zeroHigh).toBeCloseTo(0.2775, 3);
    const [fullLow, fullHigh] = wilson(10, 10);
    expect(fullLow).toBeCloseTo(0.7225, 3);
    expect(fullHigh).toBe(1);
  });

  it('is the whole range when there is no data', () => {
    expect(wilson(0, 0)).toEqual([0, 1]);
    expect(proportion(0, 0).value).toBeNull();
  });

  it('narrows as the sample grows', () => {
    const [a, b] = wilson(50, 100);
    const [c, d] = wilson(500, 1000);
    expect(d - c).toBeLessThan(b - a);
  });
});

describe('percentile', () => {
  it('takes the nearest rank', () => {
    expect(percentile([4, 1, 3, 2], 0.5)).toBe(2);
    expect(
      percentile(
        Array.from({ length: 100 }, (_, i) => i + 1),
        0.95,
      ),
    ).toBe(95);
    expect(percentile([], 0.5)).toBe(0);
  });
});

interface Spec {
  expected: CaseResult['expected'];
  got: Partial<CaseResult['got']>;
  tags?: Tag[];
}

const result = (spec: Spec): CaseResult => ({
  id: 'x',
  text: 't',
  tags: spec.tags ?? ['plain'],
  latencyMs: 1,
  expected: spec.expected,
  got: {
    title: null,
    riskClass: null,
    outcome: 'auto',
    reasons: [],
    degraded: false,
    confidence: 1,
    ...spec.got,
  },
});

describe('summarize', () => {
  const results: CaseResult[] = [
    result({
      expected: { title: 'A', riskClass: 'A', outcome: 'auto' },
      got: { title: 'A', riskClass: 'A', outcome: 'auto' },
    }),
    result({
      expected: { title: 'B', riskClass: 'B', outcome: 'auto' },
      got: { title: 'C', riskClass: 'C', outcome: 'refer' },
    }),
    result({
      expected: { title: 'C', riskClass: 'C', outcome: 'refer' },
      got: { title: 'C', riskClass: 'C', outcome: 'refer' },
      tags: ['risky'],
    }),
    result({
      expected: { title: null, riskClass: null, outcome: 'refer' },
      got: { outcome: 'auto' },
      tags: ['unknown'],
    }),
  ];
  const s = summarize(results);

  it('counts accuracy, recall, precision and unsafe automation', () => {
    expect(s.n).toBe(4);
    expect(s.top1).toMatchObject({ successes: 2, n: 3 }); // the unknown case has no expected title
    expect(s.classAccuracy).toMatchObject({ successes: 3, n: 4 }); // an unknown event with no class is right too
    expect(s.outcomeAccuracy).toMatchObject({ successes: 2, n: 4 });
    expect(s.referralRecall).toMatchObject({ successes: 1, n: 2 });
    expect(s.referralPrecision).toMatchObject({ successes: 1, n: 2 });
    expect(s.automaticRate).toMatchObject({ successes: 2, n: 4 });
    expect(s.unsafeAutomation).toBe(1);
  });

  it('breaks results down by kind of case', () => {
    expect(Object.keys(s.byTag).sort()).toEqual(['plain', 'risky', 'unknown']);
    expect(s.byTag.risky?.outcomeAccuracy.value).toBe(1);
    expect(s.byTag.unknown?.top1.value).toBeNull();
  });

  it('puts every metric in the report', () => {
    const text = renderReport({ provider: 'fake', summary: s, results }, '2026-11-13');
    for (const label of [
      'Top-1 activity accuracy',
      'Risk class accuracy',
      'Outcome accuracy',
      'Referral recall',
      'Referral precision',
      'Automatic rate',
      'Unsafe automation',
      'Latency p50 / p95',
      'By kind of case',
    ]) {
      expect(text).toContain(label);
    }
  });
});

describe('the golden set', () => {
  it('is large, unique and consistent with the catalogue', () => {
    expect(GOLDEN.length).toBeGreaterThanOrEqual(200);
    expect(new Set(GOLDEN.map((g) => g.id)).size).toBe(GOLDEN.length);
    const classByTitle = new Map(generate(42).activities.map((a) => [a.title, a.riskClass]));
    for (const g of GOLDEN) {
      if (g.title === null) expect(g.riskClass).toBeNull();
      else expect(classByTitle.get(g.title), `${g.id}: ${g.title}`).toBe(g.riskClass);
    }
  });

  it('covers every kind of case and keeps a sensible share that must be referred', () => {
    const tags = new Set(GOLDEN.flatMap((g) => g.tags));
    for (const tag of [
      'plain',
      'typo',
      'french',
      'multi',
      'injection',
      'unknown',
      'missing',
      'large',
      'excluded',
      'risky',
      'paraphrase',
    ]) {
      expect(tags.has(tag as never), tag).toBe(true);
    }
    const refer = GOLDEN.filter((g) => g.outcome === 'refer').length / GOLDEN.length;
    expect(refer).toBeGreaterThan(0.3);
    expect(refer).toBeLessThan(0.5);
  });

  it('only expects automation for events that are not risky, excluded, unknown, missing or large', () => {
    for (const g of GOLDEN.filter((x) => x.outcome === 'auto')) {
      expect(
        g.tags.some((t) =>
          ['risky', 'excluded', 'unknown', 'missing', 'large', 'injection'].includes(t),
        ),
        g.id,
      ).toBe(false);
    }
  });
});

describe('the offline baseline', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, generate(42));
  });
  afterAll(() => t.drop());

  it('never prices a must-refer description automatically and stays at or above the committed baseline', async () => {
    const embedder = createLexicalEmbedder();
    await embedCatalogue(t.db, embedder);
    const baseline = JSON.parse(
      readFileSync(join(import.meta.dirname, '..', '..', '..', 'evals', 'baseline.json'), 'utf8'),
    ).fake;
    const { summary } = await runEval(
      GOLDEN,
      { db: t.db, llm: createKeywordLlm(), embedder },
      'fake',
    );
    expect(summary.unsafeAutomation).toBeLessThanOrEqual(baseline.maxUnsafeAutomation);
    expect(summary.referralRecall.value ?? 0).toBeGreaterThanOrEqual(baseline.referralRecall);
    expect(summary.top1.value ?? 0).toBeGreaterThanOrEqual(baseline.top1);
    expect(summary.outcomeAccuracy.value ?? 0).toBeGreaterThanOrEqual(baseline.outcomeAccuracy);
  });
});

// The answers a real model gave to the golden set are kept in evals/recordings, so that everything after the model
// (matching, scoring, the decision rules) is measured with realistic extraction, in seconds and without the model.
describe('the recorded model baseline', () => {
  const evalsDir = join(import.meta.dirname, '..', '..', '..', 'evals');
  const recording = JSON.parse(
    readFileSync(join(evalsDir, 'recordings', 'ollama.json'), 'utf8'),
  ) as Recording;
  const baselines = JSON.parse(readFileSync(join(evalsDir, 'baseline.json'), 'utf8'));

  async function measure(embedder: Embedder) {
    const t = await createTestDb();
    try {
      await seedDatabase(t.db, generate(42));
      await embedCatalogue(t.db, embedder);
      const classified = await classifyCases(GOLDEN, {
        db: t.db,
        llm: createRecordedLlm(recording),
        embedder,
      });
      return { classified, summary: judge(classified, REFERENCE_RULES, 'replay').summary };
    } finally {
      await t.drop();
    }
  }

  function expectBaseline(
    summary: Awaited<ReturnType<typeof measure>>['summary'],
    baseline: Record<string, number>,
  ) {
    expect(summary.unsafeAutomation).toBeLessThanOrEqual(baseline.maxUnsafeAutomation as number);
    expect(summary.referralRecall.value ?? 0).toBeGreaterThanOrEqual(
      baseline.referralRecall as number,
    );
    expect(summary.top1.value ?? 0).toBeGreaterThanOrEqual(baseline.top1 as number);
    expect(summary.outcomeAccuracy.value ?? 0).toBeGreaterThanOrEqual(
      baseline.outcomeAccuracy as number,
    );
  }

  it('holds the committed baseline with the offline embedder', async () => {
    expectBaseline(
      (await measure(createLexicalEmbedder())).summary,
      baselines[recordingLabel(recording)],
    );
  }, 120_000);

  it.skipIf(!isModelCached())(
    'holds the committed baseline with the multilingual embedder, and is safe at every confidence threshold',
    async () => {
      const { classified, summary } = await measure(await createTransformersEmbedder());
      expectBaseline(summary, baselines[`${recordingLabel(recording)}+transformers`]);
      for (const row of sweepConfidence(classified, [0.4, 0.5, 0.6, 0.7, 0.8, 0.9])) {
        expect(row.unsafeAutomation, `autoConfidenceMin ${row.autoConfidenceMin}`).toBe(0);
      }
    },
    600_000,
  );

  it('is not stale: every description in the golden set has a recorded answer', () => {
    expect(Object.keys(recording.responses).length).toBeGreaterThanOrEqual(GOLDEN.length);
  });
});
