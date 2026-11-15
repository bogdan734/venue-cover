import { createHash } from 'node:crypto';
import { TAG } from '../../privacy/index.js';
import type { LlmProvider, LlmRequest } from '../llm.js';

// A model's answers kept on disk. Everything after the model (matching, scoring, the decision rules) can then be
// measured again in seconds with exactly the answers it gave, and a demo can run without a model or a key.
export interface Recording {
  model: string;
  /** Keyed by the whole request: instructions, schema and text. */
  responses: Record<string, unknown>;
}

// A request under changed instructions has another key, so a stale recording misses; it never answers wrongly. The id in
// a privacy tag depends on the deployment's key, so it is left out: "[NAME#7K3Q2A]" is keyed as "[NAME]".
const keyOf = (r: LlmRequest): string =>
  createHash('sha256')
    .update(`${r.system}\n${JSON.stringify(r.schema)}\n${r.user.replace(TAG, '[$1]')}`)
    .digest('hex')
    .slice(0, 24);

// Wraps a model and keeps what it answers. `recording()` returns everything so far, keys in a fixed order.
export function createRecordingLlm(
  inner: LlmProvider,
  model: string,
  known: Recording['responses'] = {},
): { llm: LlmProvider; recording(): Recording } {
  const responses: Recording['responses'] = { ...known };
  return {
    llm: {
      async completeJson(request) {
        const answer = await inner.completeJson(request);
        responses[keyOf(request)] = answer;
        return answer;
      },
    },
    recording: () => ({
      model,
      responses: Object.fromEntries(
        Object.entries(responses).sort(([a], [b]) => a.localeCompare(b)),
      ),
    }),
  };
}

// Answers from the recording. A request that was never recorded goes to `fallback`, or is an error without one.
export function createRecordedLlm(recording: Recording, fallback?: LlmProvider): LlmProvider {
  return {
    async completeJson(request) {
      const key = keyOf(request);
      if (key in recording.responses) return recording.responses[key];
      if (fallback) return fallback.completeJson(request);
      throw new Error(
        `no recorded answer for "${request.user.slice(0, 60)}" (the text or the prompt changed): record it again`,
      );
    },
  };
}
