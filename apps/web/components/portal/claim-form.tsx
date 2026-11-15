'use client';

import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/field';
import { type FormAction, useServerForm } from '@/components/use-server-form';

// A first notice of loss on a policy. The API refuses a date outside the policy period, and says which days it covers.
export function ClaimForm({
  action,
  lossDate,
  reporter,
  idem,
}: {
  action: FormAction;
  lossDate: string;
  reporter: { name: string; email: string };
  idem: string;
}) {
  const { state, pending, onSubmit } = useServerForm(action);
  if (state.done) return <Notice tone="ok">{state.done}</Notice>;
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <input type="hidden" name="idem" value={idem} />
      <Field label="Day of the loss" htmlFor="lossDate">
        <Input id="lossDate" name="lossDate" type="date" required defaultValue={lossDate} />
      </Field>
      <Field label="What happened" htmlFor="description">
        <Textarea
          id="description"
          name="description"
          rows={3}
          required
          minLength={10}
          maxLength={5000}
          placeholder="A guest slipped near the buffet and hurt a wrist."
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name" htmlFor="reporterName">
          <Input id="reporterName" name="reporterName" required defaultValue={reporter.name} />
        </Field>
        <Field label="E-mail" htmlFor="reporterEmail">
          <Input
            id="reporterEmail"
            name="reporterEmail"
            type="email"
            required
            defaultValue={reporter.email}
          />
        </Field>
      </div>
      {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
      <Button type="submit" variant="secondary" disabled={pending} aria-busy={pending}>
        {pending ? 'Sending…' : 'Report the loss'}
      </Button>
    </form>
  );
}
