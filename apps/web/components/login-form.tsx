'use client';

import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/field';
import { type FormAction, useServerForm } from '@/components/use-server-form';

export function LoginForm({ action, next }: { action: FormAction; next: string }) {
  const { state, pending, onSubmit } = useServerForm(action);
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <Field label="Password" htmlFor="password">
        <Input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          autoFocus
        />
      </Field>
      {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
      <Button type="submit" disabled={pending} aria-busy={pending} className="w-full">
        {pending ? 'Checking…' : 'Open the console'}
      </Button>
    </form>
  );
}
