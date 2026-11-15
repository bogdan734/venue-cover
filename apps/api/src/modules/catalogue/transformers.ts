import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Embedder } from './embedder.js';

export const E5_MODEL = 'Xenova/multilingual-e5-small';
// Beside the repository, ignored by git: the model is downloaded once and then runs offline.
export const DEFAULT_MODEL_CACHE = fileURLToPath(
  new URL('../../../../../.cache/models', import.meta.url),
);

// True when the model is already in the cache, so that creating the embedder will not download anything.
export const isModelCached = (cacheDir: string = DEFAULT_MODEL_CACHE): boolean =>
  existsSync(join(cacheDir, E5_MODEL));

// Multilingual sentence embeddings run in this process by transformers.js (a quantised ONNX model, 384 dimensions,
// English and French among about 100 languages). The model expects "query: " and "passage: " in front of the text.
// The first call downloads about 120 MB from the Hugging Face hub into `cacheDir`.
export async function createTransformersEmbedder(
  options: { cacheDir?: string } = {},
): Promise<Embedder> {
  const { env, pipeline } = await import('@huggingface/transformers');
  env.cacheDir = options.cacheDir ?? DEFAULT_MODEL_CACHE;
  const extract = await pipeline('feature-extraction', E5_MODEL, { dtype: 'q8' });
  return {
    id: `${E5_MODEL}:q8`,
    dimensions: 384,
    // Measured with `npm run eval:calibrate` on the golden set and the recorded answers of a local model: phrases that are
    // not activities peak at a cosine of 0.84 (median 0.83); phrases that name the expected activity start at 0.86 and
    // have a median of 0.90. Of the 60 settings swept around these, 40 were safe (nothing unsafe, every must-refer case
    // referred, unknown activities named as such) and 87.6% of cases were routed right at this one, in the middle of them (on the set it was chosen on).
    scale: { floor: 0.83, ceiling: 0.87, weight: 0.8 },
    async embed(texts, kind) {
      const output = await extract(
        texts.map((text) => `${kind}: ${text}`),
        { pooling: 'mean', normalize: true },
      );
      return output.tolist() as number[][];
    },
  };
}
