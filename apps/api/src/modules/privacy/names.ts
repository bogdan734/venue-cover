import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_MODEL_CACHE } from '../catalogue/index.js';
import type { Span } from './detect.js';

// Person names, found by a multilingual named-entity model (DistilBERT, quantised ONNX, about 135 MB) that runs in this
// process through transformers.js. English and French among its ten languages. Nothing leaves the machine.
export const NAME_MODEL = 'Xenova/distilbert-base-multilingual-cased-ner-hrl';

export type NameFinder = (text: string) => Promise<Span[]>;

/** One word piece as the token-classification pipeline reports it. */
export interface Entity {
  entity: string;
  score: number;
  index: number;
  word: string;
}

export const isNameModelCached = (cacheDir: string = DEFAULT_MODEL_CACHE): boolean =>
  existsSync(join(cacheDir, NAME_MODEL));

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// How sure the model must be of a single word that opens a sentence.
const SURE = 0.9;

// The pipeline labels word pieces (B- starts an entity, I- continues one, "##" is the rest of a word) and gives no
// character offsets. A person is a run of adjacent pieces that starts with a confident PER label; the model sometimes
// calls the rest of a name a place (Chloé as B-PER, Tremblay as I-LOC), so whatever continues the run belongs to it. Each
// person is then found in the text, in order.
export function spansFromEntities(text: string, entities: Entity[], minScore = 0.5): Span[] {
  const people: Entity[][] = [];
  let current: Entity[] | null = null;
  let previous: Entity | null = null;
  for (const entity of [...entities].sort((a, b) => a.index - b.index)) {
    const piece = entity.word.startsWith('##');
    const adjacent = previous !== null && entity.index === previous.index + 1;
    if (adjacent && (piece || entity.entity.startsWith('I-'))) {
      current?.push(entity);
    } else {
      const person = entity.entity.endsWith('-PER') && !piece && entity.score >= minScore;
      current = person ? [entity] : null;
      if (current) people.push(current);
    }
    previous = entity;
  }

  const spans: Span[] = [];
  let cursor = 0;
  for (const person of people) {
    if (person.some((e) => e.word === '[UNK]')) continue;
    const pattern = person
      .map((e, i) =>
        e.word.startsWith('##')
          ? literal(e.word.slice(2))
          : `${i === 0 ? '' : '\\s*'}${literal(e.word)}`,
      )
      .join('');
    const match = new RegExp(pattern, 'u').exec(text.slice(cursor));
    if (!match) continue;
    const start = cursor + match.index;
    cursor = start + match[0].length;
    // A capital letter at the start of a sentence says nothing, so a lone word there needs a surer model.
    const opensSentence = /(?:^|[.!?\n])\s*$/.test(text.slice(0, start));
    const oneWord = !/\s/.test(match[0]);
    if (opensSentence && oneWord && (person[0] as Entity).score < SURE) continue;
    spans.push({ start, end: cursor, kind: 'NAME' });
  }
  return spans;
}

// The model reads at most 512 pieces at once, so a long text (a client's letter) is read a paragraph or so at a time.
function* chunks(text: string, size = 1000): Generator<[number, string]> {
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + size);
    if (end < text.length) {
      const cut = Math.max(text.lastIndexOf('\n', end), text.lastIndexOf('. ', end));
      if (cut > start + size / 2) end = cut + 1;
    }
    yield [start, text.slice(start, end)];
    start = end;
  }
}

// Loads the model from the cache (downloading it the first time, when it is not there).
export async function createNameModel(options: { cacheDir?: string } = {}): Promise<NameFinder> {
  const { env, pipeline } = await import('@huggingface/transformers');
  env.cacheDir = options.cacheDir ?? DEFAULT_MODEL_CACHE;
  const ner = await pipeline('token-classification', NAME_MODEL, { dtype: 'int8' });
  return async (text) => {
    const spans: Span[] = [];
    for (const [offset, chunk] of chunks(text)) {
      const entities = (await ner(chunk)) as unknown as Entity[];
      for (const span of spansFromEntities(chunk, entities)) {
        spans.push({ ...span, start: span.start + offset, end: span.end + offset });
      }
    }
    return spans;
  };
}
