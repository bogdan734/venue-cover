import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { seedDatabase } from '../apps/api/src/db/seed.js';
import {
  createTransformersEmbedder,
  type Embedder,
  embedCatalogue,
} from '../apps/api/src/modules/catalogue/index.js';
import { createRecordedLlm, type Recording } from '../apps/api/src/modules/intake/index.js';
import { createTestDb } from '../apps/api/test/db.js';
import { generate } from '../data/generate.js';
import { GOLDEN } from './golden.js';
import { classifyCases, judge, REFERENCE_RULES } from './runner.js';

// Reads off how the model's cosine similarities are spread, then sweeps the `scale` of the embedder against the golden
// set with the recorded model answers. The numbers in `createTransformersEmbedder` come from here; run it again when
// the model changes.
//   npm run eval:calibrate [-- --recording file]
//
// A setting is safe when it prices nothing it should refer, refers every must-refer case, and still names an unknown
// activity as unknown. Among the safe settings the best is the one that routes the most cases correctly.

const args = process.argv.slice(2);
const at = args.indexOf('--recording');
const recordingFile =
  at === -1 ? join(import.meta.dirname, 'recordings', 'ollama.json') : (args[at + 1] as string);

const WEIGHTS = [0.7, 0.8, 0.9, 1];
const FLOORS = [0.82, 0.83, 0.84, 0.85];
const CEILINGS = [0.85, 0.86, 0.87, 0.88];
const MIN_UNKNOWN_FLAGGED = 0.9;

const dot = (a: number[], b: number[]) => a.reduce((sum, x, i) => sum + x * (b[i] ?? 0), 0);
const quantile = (values: number[], q: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? Number.NaN;
};
const spread = (name: string, values: number[]) =>
  `| ${name} | ${[0, 0.05, 0.25, 0.5, 0.75, 0.95, 1].map((q) => quantile(values, q).toFixed(3)).join(' | ')} |`;

// Every phrase is embedded once, however often the sweep asks for it.
function memoised(inner: Embedder, scale: Embedder['scale']): Embedder {
  const cache = new Map<string, number[]>();
  return {
    ...inner,
    scale,
    async embed(texts, kind) {
      const missing = texts.filter((text) => !cache.has(`${kind}:${text}`));
      if (missing.length > 0) {
        const vectors = await inner.embed(missing, kind);
        for (const [i, text] of missing.entries())
          cache.set(`${kind}:${text}`, vectors[i] as number[]);
      }
      return texts.map((text) => cache.get(`${kind}:${text}`) as number[]);
    },
  };
}

const t = await createTestDb();
try {
  const data = generate(42);
  await seedDatabase(t.db, data);
  const model = await createTransformersEmbedder();
  await embedCatalogue(t.db, model);
  const llm = createRecordedLlm(JSON.parse(readFileSync(recordingFile, 'utf8')) as Recording);

  // 1. The spread of cosines. At the pure-cosine scale a phrase's best score is its cosine, so the recorded answers
  //    show what real phrases score: the ones that name the expected activity, and the ones in cases that name none.
  const pure = await classifyCases(GOLDEN, {
    db: t.db,
    llm,
    embedder: memoised(model, { floor: 0, ceiling: 1, weight: 1 }),
  });
  const best = (c: (typeof pure)[number]) =>
    c.classification.phrases.flatMap((p) => (p.candidates[0] ? [p.candidates[0]] : []));
  const named = pure.flatMap((c) =>
    best(c)
      .filter((m) => m.title === c.golden.title)
      .map((m) => m.score),
  );
  const none = pure
    .filter((c) => c.golden.title === null)
    .flatMap((c) => best(c).map((m) => m.score));
  const passages = await model.embed(
    data.activities.map((a) => a.searchText),
    'passage',
  );
  const titles = await model.embed(
    data.activities.map((a) => a.title),
    'query',
  );
  console.log('| cosine | min | 5% | 25% | median | 75% | 95% | max |');
  console.log('|---|---|---|---|---|---|---|---|');
  console.log(
    spread(
      'an activity title with its own entry',
      titles.map((v, i) => dot(v, passages[i] as number[])),
    ),
  );
  console.log(spread('a phrase that names the expected activity', named));
  console.log(spread('a phrase in a case that names no known activity', none));
  console.log();

  // 2. The sweep.
  const unknownIds = new Set(GOLDEN.filter((g) => g.tags.includes('unknown')).map((g) => g.id));
  const frenchIds = new Set(GOLDEN.filter((g) => g.tags.includes('french')).map((g) => g.id));
  const rows: { line: string; outcome: number; top1: number; safe: boolean }[] = [];
  for (const weight of WEIGHTS) {
    for (const floor of FLOORS) {
      for (const ceiling of CEILINGS) {
        if (ceiling <= floor) continue;
        const embedder = memoised(model, { floor, ceiling, weight });
        const classified = await classifyCases(GOLDEN, { db: t.db, llm, embedder });
        const all = judge(classified, REFERENCE_RULES, 'sweep');
        const french = judge(
          classified.filter((c) => frenchIds.has(c.golden.id)),
          REFERENCE_RULES,
          'french',
        ).summary;
        const unknown = all.results.filter((r) => unknownIds.has(r.id));
        const flagged =
          unknown.length === 0
            ? 1
            : unknown.filter((r) => r.got.reasons.includes('UNKNOWN_ACTIVITY')).length /
              unknown.length;
        const s = all.summary;
        const pct = (value: number | null) => (value ?? 0) * 100;
        rows.push({
          outcome: pct(s.outcomeAccuracy.value),
          top1: pct(s.top1.value),
          safe:
            s.unsafeAutomation === 0 &&
            (s.referralRecall.value ?? 0) === 1 &&
            flagged >= MIN_UNKNOWN_FLAGGED,
          line: `| ${weight} | ${floor} | ${ceiling} | ${pct(s.top1.value).toFixed(1)} | ${pct(s.outcomeAccuracy.value).toFixed(1)} | ${pct(s.automaticRate.value).toFixed(1)} | ${(flagged * 100).toFixed(0)} | ${pct(french.top1.value).toFixed(0)} |`,
        });
      }
    }
  }
  const safe = rows.filter((r) => r.safe).sort((a, b) => b.outcome - a.outcome || b.top1 - a.top1);
  console.log(
    '| weight | floor | ceiling | top-1 % | outcome % | automatic % | unknown flagged % | french top-1 % |',
  );
  console.log('|---|---|---|---|---|---|---|---|');
  for (const r of safe.slice(0, 40)) console.log(r.line);
  console.log(`\n${safe.length} of ${rows.length} settings are safe.`);
} finally {
  await t.drop();
}
