'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/field';
import { type FormAction, type FormState, useServerForm } from '@/components/use-server-form';

export function EndpointForm({
  action,
  eventTypes,
  suggestions,
}: {
  action: FormAction;
  eventTypes: readonly string[];
  suggestions: string[];
}) {
  const { state, pending, onSubmit } = useServerForm(action);
  const [url, setUrl] = useState('');
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Receiver URL" htmlFor="url" hint="https only; private addresses are refused.">
        <Input
          id="url"
          name="url"
          required
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://hooks.example.test/ok"
        />
      </Field>
      <ul className="flex flex-wrap gap-2 text-sm">
        {suggestions.map((suggestion) => (
          <li key={suggestion}>
            <button
              type="button"
              onClick={() => setUrl(suggestion)}
              className="rounded-full border border-line-strong bg-surface px-3 py-1 font-mono text-[0.75rem] text-ink-soft transition-colors duration-150 hover:border-brand hover:text-brand"
            >
              {suggestion.replace('https://hooks.example.test', '…')}
            </button>
          </li>
        ))}
      </ul>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-ink-soft">Events</legend>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {eventTypes.map((type) => (
            <label
              key={type}
              className="flex items-center gap-2 font-mono text-[0.8rem] text-ink-soft"
            >
              <input
                type="checkbox"
                name="events"
                value={type}
                defaultChecked={type === 'policy.issued'}
                className="accent-brand"
              />
              {type}
            </label>
          ))}
        </div>
      </fieldset>
      {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
      {state.done ? <Notice tone="ok">{state.done}</Notice> : null}
      <Button type="submit" disabled={pending} aria-busy={pending}>
        {pending ? 'Registering…' : 'Register endpoint'}
      </Button>
    </form>
  );
}

// A small button that runs a server action and shows its refusal, if any, beside it.
export function ActionButton({
  run,
  children,
  label,
  variant = 'secondary',
}: {
  run: () => Promise<FormState>;
  children: React.ReactNode;
  label: string;
  variant?: 'secondary' | 'danger';
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant={variant}
        disabled={pending}
        aria-label={label}
        onClick={() => start(async () => setError((await run()).error))}
      >
        {pending ? '…' : children}
      </Button>
      {error ? <span className="text-sm text-danger">{error}</span> : null}
    </span>
  );
}
