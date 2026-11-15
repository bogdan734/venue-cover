import 'server-only';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EvalResult, PrivacyEval } from './types';

// The evaluations the repository keeps, from the same folder the evaluation command writes to.
const FOLDER = join(process.cwd(), '..', '..', 'evals', 'results');

export function loadEvals(): EvalResult[] {
  return readdirSync(FOLDER)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(FOLDER, name), 'utf8')) as EvalResult);
}

// Committed beside the folder above by `npm run eval:privacy`.
export function loadPrivacy(): PrivacyEval {
  return JSON.parse(readFileSync(join(FOLDER, '..', 'privacy.json'), 'utf8')) as PrivacyEval;
}

// What each evaluation is called on the page.
export const NAMES: Record<string, { title: string; note: string }> = {
  fake: {
    title: 'Plain rules, offline words',
    note: 'A keyword reader instead of a model, and the offline embedder. The floor.',
  },
  'replay-qwen2.5-14b': {
    title: 'Local model, offline words',
    note: 'The recorded answers of a 14B model run locally, matched with the offline embedder.',
  },
  'replay-qwen2.5-14b+transformers': {
    title: 'Local model, multilingual embeddings',
    note: 'The same model answers, matched with a multilingual embedding model run in process. What the demo uses when the model is on the machine.',
  },
};
