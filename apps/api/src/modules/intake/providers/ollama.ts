import type { FetchLike, LlmProvider } from '../llm.js';

export function createOllamaLlm(options: {
  model: string;
  baseUrl?: string;
  fetch?: FetchLike;
}): LlmProvider {
  const call = options.fetch ?? fetch;
  const baseUrl = options.baseUrl ?? 'http://localhost:11434';
  return {
    async completeJson({ system, user, schema }) {
      const response = await call(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: options.model,
          stream: false,
          format: schema,
          options: { temperature: 0 },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      });
      if (!response.ok) throw new Error(`Ollama answered ${response.status}`);
      const payload = (await response.json()) as { message?: { content?: string } };
      return JSON.parse(payload.message?.content ?? '');
    },
  };
}
