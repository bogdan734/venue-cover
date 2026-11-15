'use client';

import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/field';
import { type FormAction, type FormState, useServerForm } from '@/components/use-server-form';

function Outcome({ state }: { state: FormState }) {
  if (state.error) return <Notice tone="danger">{state.error}</Notice>;
  if (state.done) return <Notice tone="ok">{state.done}</Notice>;
  return null;
}

function Email({
  id = 'email',
  label = 'E-mail',
  autoFocus,
}: {
  id?: string;
  label?: string;
  autoFocus?: boolean;
}) {
  return (
    <Field label={label} htmlFor={id}>
      <Input
        id={id}
        name="email"
        type="email"
        required
        maxLength={320}
        autoComplete="email"
        autoFocus={autoFocus}
      />
    </Field>
  );
}

export function RegisterForm({ action, next }: { action: FormAction; next: string }) {
  const { state, pending, onSubmit } = useServerForm(action);
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <Field label="Your name" htmlFor="name">
        <Input id="name" name="name" required maxLength={200} autoComplete="name" autoFocus />
      </Field>
      <Email />
      <Field label="Password" htmlFor="password" hint="At least 10 characters.">
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={10}
          maxLength={200}
          autoComplete="new-password"
          aria-describedby="password-hint"
        />
      </Field>
      <Outcome state={state} />
      <Button type="submit" disabled={pending} aria-busy={pending} className="w-full">
        {pending ? 'Creating…' : 'Create my account'}
      </Button>
    </form>
  );
}

export function SignInForm({ action, next }: { action: FormAction; next: string }) {
  const { state, pending, onSubmit } = useServerForm(action);
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <Email autoFocus />
      <Field label="Password" htmlFor="password">
        <Input
          id="password"
          name="password"
          type="password"
          required
          maxLength={200}
          autoComplete="current-password"
        />
      </Field>
      <Outcome state={state} />
      <Button type="submit" disabled={pending} aria-busy={pending} className="w-full">
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}

export function ResendForm({ action }: { action: FormAction }) {
  const { state, pending, onSubmit } = useServerForm(action);
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Email id="resend-email" label="Address to confirm" />
      <Outcome state={state} />
      <Button type="submit" variant="secondary" disabled={pending} aria-busy={pending}>
        {pending ? 'Sending…' : 'Send a new link'}
      </Button>
    </form>
  );
}

export function ConfirmEmailForm({ action, token }: { action: FormAction; token: string }) {
  const { state, pending, onSubmit } = useServerForm(action);
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <Outcome state={state} />
      <Button type="submit" disabled={pending} aria-busy={pending} className="w-full">
        {pending ? 'Confirming…' : 'Confirm and sign in'}
      </Button>
    </form>
  );
}
