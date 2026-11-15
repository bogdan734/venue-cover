'use client';

import { Play } from 'lucide-react';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/field';

export function GraphqlBox({
  run,
  examples,
}: {
  run: (query: string) => Promise<string>;
  examples: { label: string; query: string }[];
}) {
  const [query, setQuery] = useState(examples[0]?.query ?? '');
  const [answer, setAnswer] = useState('');
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3 px-5 py-4">
      <ul className="flex flex-wrap gap-2">
        {examples.map((example) => (
          <li key={example.label}>
            <button
              type="button"
              onClick={() => setQuery(example.query)}
              className="rounded-full border border-line-strong bg-surface px-3 py-1 text-sm text-ink-soft transition-colors duration-150 hover:border-brand hover:text-brand"
            >
              {example.label}
            </button>
          </li>
        ))}
      </ul>
      <label htmlFor="graphql" className="sr-only">
        GraphQL query
      </label>
      <Textarea
        id="graphql"
        rows={6}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="font-mono text-[0.85rem]"
        spellCheck={false}
      />
      <Button
        type="button"
        disabled={pending || !query.trim()}
        onClick={() => start(async () => setAnswer(await run(query)))}
      >
        <Play className="size-4" aria-hidden /> {pending ? 'Running…' : 'Run'}
      </Button>
      {answer ? (
        <pre
          data-testid="answer"
          className="max-h-80 overflow-auto rounded-control border border-line bg-sunken/50 p-3 font-mono text-[0.8rem] leading-relaxed text-ink-soft"
        >
          {answer}
        </pre>
      ) : null}
    </div>
  );
}
