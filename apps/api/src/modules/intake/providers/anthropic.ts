import type { FetchLike, LlmProvider } from '../llm.js';

// Forces a tool call whose input schema is the requested schema, so the answer arrives as structured JSON.
export function createAnthropicLlm(options: {
  apiKey: string;
  model: string;
  fetch?: FetchLike;
}): LlmProvider {
  const call = options.fetch ?? fetch;
  return {
    async completeJson({ system, user, schema }) {
      const response = await call('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': options.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: options.model,
          max_tokens: 600,
          temperature: 0,
          system,
          messages: [{ role: 'user', content: user }],
          tools: [
            {
              name: 'record_facts',
              description: 'Record the facts found in the text.',
              input_schema: schema,
            },
          ],
          tool_choice: { type: 'tool', name: 'record_facts' },
        }),
      });
      if (!response.ok) throw new Error(`Anthropic answered ${response.status}`);
      const payload = (await response.json()) as { content?: { type: string; input?: unknown }[] };
      const block = payload.content?.find((b) => b.type === 'tool_use');
      if (!block) throw new Error('Anthropic returned no tool call');
      return block.input;
    },
  };
}
