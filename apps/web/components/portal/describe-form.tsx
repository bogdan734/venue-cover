'use client';

import { ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Textarea } from '@/components/ui/field';
import { type FormAction, useServerForm } from '@/components/use-server-form';

// The first thing a renter does: say what the event is, in their own words. An example can be put in with one click.
export function DescribeForm({
  action,
  examples,
}: {
  action: FormAction;
  examples: readonly { label: string; text: string }[];
}) {
  const { state, pending, onSubmit } = useServerForm(action);
  const [text, setText] = useState('');

  return (
    <form onSubmit={onSubmit}>
      <label htmlFor="text" className="sr-only">
        Describe your event
      </label>
      <Textarea
        id="text"
        name="text"
        rows={4}
        required
        maxLength={2000}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="For example: a birthday party for 40 guests on Saturday evening, about four hours, with a bouncy castle. No alcohol."
        className="text-[1.05rem]"
      />

      {state.error ? (
        <div className="mt-3">
          <Notice tone="danger">{state.error}</Notice>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? 'Reading…' : 'Read my description'}
          {pending ? null : <ArrowRight className="size-4" aria-hidden />}
        </Button>
        <span className="text-sm text-ink-faint">Nothing is bought at this step.</span>
      </div>

      <div className="mt-8">
        <p className="text-sm font-medium text-ink-soft">Or try one of these</p>
        <ul className="mt-2.5 flex flex-wrap gap-2">
          {examples.map((example) => (
            <li key={example.label}>
              <button
                type="button"
                title={example.text}
                onClick={() => setText(example.text)}
                className="rounded-full border border-line-strong bg-surface px-3.5 py-1.5 text-sm text-ink-soft transition-colors duration-150 hover:border-brand hover:text-brand"
              >
                {example.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </form>
  );
}
