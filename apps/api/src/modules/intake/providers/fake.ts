import type { LlmProvider, LlmRequest } from '../llm.js';

// Scripted provider for tests: the handler decides what the "model" answers (it may also throw).
export function createFakeLlm(handler: (request: LlmRequest) => unknown): LlmProvider {
  return { completeJson: async (request) => handler(request) };
}
