// An embedder turns text into a unit vector. `kind` matters for models that prefix queries and passages differently.
export interface Embedder {
  /** Names the model, so that vectors made by another one are not mistaken for this one's. */
  readonly id: string;
  readonly dimensions: number;
  /**
   * How to read this model's cosine similarities. Models differ: one scores unrelated texts near 0, another near 0.8.
   * `floor` is what unrelated texts score and `ceiling` what the same activity scores; the cosine is stretched to the
   * range between them. `weight` is the share of the match score that comes from the vector; the rest is spelling
   * (trigram overlap), which catches typos and exact titles.
   */
  readonly scale: { floor: number; ceiling: number; weight: number };
  embed(texts: string[], kind: 'query' | 'passage'): Promise<number[][]>;
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function features(text: string): string[] {
  const words = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  const out: string[] = [];
  for (const word of words) {
    out.push(`w:${word}`);
    const padded = ` ${word} `;
    for (let i = 0; i + 3 <= padded.length; i++) out.push(`t:${padded.slice(i, i + 3)}`);
  }
  return out;
}

// Offline and deterministic: signed feature hashing of words and character trigrams. It catches typos, aliases and
// word overlap, but knows nothing about meaning ("pyrotechnics" is not close to "fireworks"). Used in tests and as
// the fallback when no model is available; a real model plugs in through the same interface.
export function createLexicalEmbedder(dimensions = 384): Embedder {
  return {
    id: `lexical-${dimensions}`,
    dimensions,
    scale: { floor: 0, ceiling: 1, weight: 0.6 },
    async embed(texts) {
      return texts.map((text) => {
        const vector = new Array<number>(dimensions).fill(0);
        for (const feature of features(text)) {
          const hash = fnv1a(feature);
          const index = hash % dimensions;
          vector[index] =
            (vector[index] ?? 0) +
            ((hash >>> 16) & 1 ? 1 : -1) * (feature.startsWith('w:') ? 1 : 0.5);
        }
        const norm = Math.hypot(...vector) || 1;
        return vector.map((x) => x / norm);
      });
    },
  };
}

export const toVectorLiteral = (vector: number[]): string =>
  `[${vector.map((x) => x.toFixed(6)).join(',')}]`;
