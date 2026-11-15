import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { seedDatabase } from '../apps/api/src/db/seed.js';
import {
  createLexicalEmbedder,
  createTransformersEmbedder,
  type Embedder,
  embedCatalogue,
} from '../apps/api/src/modules/catalogue/index.js';
import {
  createAnthropicLlm,
  createKeywordLlm,
  createOllamaLlm,
  createRecordedLlm,
  createRecordingLlm,
  type LlmProvider,
  type Recording,
} from '../apps/api/src/modules/intake/index.js';
import { draftRules } from '../apps/api/src/modules/setup/index.js';
import { createTestDb } from '../apps/api/test/db.js';
import { LETTER_EXAMPLES } from '../data/examples.js';
import { generate } from '../data/generate.js';
import { GOLDEN } from './golden.js';
import { renderReport } from './report.js';
import {
  classifyCases,
  EVAL_SHIELD,
  judge,
  REFERENCE_RULES,
  recordingLabel,
  sweepConfidence,
} from './runner.js';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
};

const provider = value('provider') ?? 'fake';
const embedderName = value('embedder') ?? 'lexical';
const recordingFile = value('recording') ?? join(import.meta.dirname, 'recordings', 'ollama.json');
const recording =
  provider === 'replay' ? (JSON.parse(readFileSync(recordingFile, 'utf8')) as Recording) : null;
// Reports and baselines are named by what was measured: the model (the recorded one, for a replay), plus the
// embedder when it is not the offline one.
const modelName = recording ? recordingLabel(recording) : provider;
const label = embedderName === 'lexical' ? modelName : `${modelName}+${embedderName}`;
const limit = Number(value('limit') ?? GOLDEN.length);

async function embedderFor(name: string): Promise<Embedder> {
  if (name === 'lexical') return createLexicalEmbedder();
  if (name === 'transformers') return createTransformersEmbedder();
  throw new Error(`unknown embedder ${name} (lexical or transformers)`);
}

const modelOf = (name: string): string =>
  name === 'ollama'
    ? (process.env.OLLAMA_MODEL ?? 'qwen2.5:14b')
    : name === 'anthropic'
      ? (process.env.ANTHROPIC_MODEL ?? name)
      : name;

function llmFor(name: string): LlmProvider {
  if (name === 'fake') return createKeywordLlm();
  if (name === 'replay' && recording) return createRecordedLlm(recording);
  if (name === 'ollama') return createOllamaLlm({ model: modelOf(name) });
  if (name === 'anthropic') {
    const key = process.env.ANTHROPIC_API_KEY;
    const model = process.env.ANTHROPIC_MODEL;
    if (!key || !model)
      throw new Error(
        'ANTHROPIC_API_KEY and ANTHROPIC_MODEL are required for --provider anthropic',
      );
    return createAnthropicLlm({ apiKey: key, model });
  }
  throw new Error(`unknown provider ${name} (fake, replay, ollama or anthropic)`);
}

const t = await createTestDb();
try {
  await seedDatabase(t.db, generate(42));
  const embedder = await embedderFor(embedderName);
  await embedCatalogue(t.db, embedder);
  const llm = llmFor(provider);
  const recorder = flag('record') ? createRecordingLlm(llm, modelOf(provider)) : null;
  const classified = await classifyCases(GOLDEN.slice(0, limit), {
    db: t.db,
    llm: recorder?.llm ?? llm,
    embedder,
  });
  if (recorder) {
    // The demo also offers letters to draft program rules from; their answers belong in the same recording.
    for (const letter of LETTER_EXAMPLES) {
      await draftRules(letter.text, REFERENCE_RULES, {
        db: t.db,
        llm: recorder.llm,
        embedder,
        shield: EVAL_SHIELD,
      });
    }
    const made = recorder.recording();
    writeFileSync(recordingFile, `${JSON.stringify(made, null, 2)}\n`);
    console.log(
      `recorded ${Object.keys(made.responses).length} answers of ${made.model} to ${recordingFile}`,
    );
  }
  const report = judge(classified, REFERENCE_RULES, label);
  const date = new Date().toISOString().slice(0, 10);
  const markdown = renderReport(report, date);
  console.log(markdown);
  if (flag('sweep')) {
    const pctOf = (v: number | null) => (v === null ? 'n/a' : `${(v * 100).toFixed(1)}%`);
    console.log('\n## Confidence threshold sweep\n');
    console.log(
      '| autoConfidenceMin | Automatic rate | Unsafe automation | Outcome accuracy | Referral precision |',
    );
    console.log('|---|---|---|---|---|');
    for (const row of sweepConfidence(classified, [0.4, 0.5, 0.6, 0.7, 0.8, 0.85, 0.9])) {
      console.log(
        `| ${row.autoConfidenceMin} | ${pctOf(row.automaticRate)} | ${row.unsafeAutomation} | ${pctOf(row.outcomeAccuracy)} | ${pctOf(row.referralPrecision)} |`,
      );
    }
  }
  if (flag('json')) {
    // The committed results the web app's quality page reads.
    const file = join(import.meta.dirname, 'results', `${label}.json`);
    const sweep = sweepConfidence(classified, [0.4, 0.5, 0.6, 0.7, 0.8, 0.85, 0.9]);
    writeFileSync(
      file,
      `${JSON.stringify({ label, date, summary: report.summary, sweep }, null, 2)}\n`,
    );
    console.log(`written ${file}`);
  }
  if (flag('write')) {
    const file = join(import.meta.dirname, 'reports', `${date}-${label}.md`);
    writeFileSync(file, markdown);
    console.log(`written ${file}`);
  }
  if (flag('update-baseline')) {
    const file = join(import.meta.dirname, 'baseline.json');
    const baseline = JSON.parse(readFileSync(file, 'utf8').toString() || '{}');
    const s = report.summary;
    baseline[label] = {
      top1: Math.floor((s.top1.value ?? 0) * 100) / 100,
      outcomeAccuracy: Math.floor((s.outcomeAccuracy.value ?? 0) * 100) / 100,
      referralRecall: Math.floor((s.referralRecall.value ?? 0) * 100) / 100,
      maxUnsafeAutomation: s.unsafeAutomation,
    };
    writeFileSync(file, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(`baseline updated: ${JSON.stringify(baseline[label])}`);
  }
  if (flag('check') && report.summary.unsafeAutomation > 0) {
    console.error(`unsafe automation: ${report.summary.unsafeAutomation}`);
    process.exitCode = 1;
  }
} finally {
  await t.drop();
}
