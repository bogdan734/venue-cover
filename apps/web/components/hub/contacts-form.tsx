'use client';

import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/field';
import { type FormAction, useServerForm } from '@/components/use-server-form';
import type { Contacts } from '@/lib/types';

// The program's own support desk, shown at the foot of its portal. Any field can stay empty.
export function ContactsForm({
  action,
  initial,
}: {
  action: FormAction;
  initial: Contacts | null;
}) {
  const { state, pending, onSubmit } = useServerForm(action);
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Support e-mail" htmlFor="supportEmail">
          <Input
            id="supportEmail"
            name="supportEmail"
            type="email"
            defaultValue={initial?.supportEmail ?? ''}
            placeholder="help@example.org"
          />
        </Field>
        <Field label="Phone" htmlFor="supportPhone">
          <Input
            id="supportPhone"
            name="supportPhone"
            type="tel"
            defaultValue={initial?.supportPhone ?? ''}
            placeholder="+1 613 555 0100"
          />
        </Field>
        <Field label="Telegram" htmlFor="telegram" hint="The bot or account renters can write to.">
          <Input
            id="telegram"
            name="telegram"
            defaultValue={initial?.telegram ?? ''}
            placeholder="@example_help_bot"
          />
        </Field>
        <Field label="Hours" htmlFor="hours">
          <Input
            id="hours"
            name="hours"
            maxLength={80}
            defaultValue={initial?.hours ?? ''}
            placeholder="Weekdays 9 to 5, Eastern"
          />
        </Field>
      </div>
      {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
      {state.done ? <Notice tone="ok">{state.done}</Notice> : null}
      <Button type="submit" variant="secondary" disabled={pending} aria-busy={pending}>
        {pending ? 'Saving…' : 'Save the contacts'}
      </Button>
    </form>
  );
}
