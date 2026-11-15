'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { type FormAction, useServerForm } from '@/components/use-server-form';
import { money } from '@/lib/format';
import type { WorksheetLine } from '@/lib/types';

type Action = 'approve' | 'approve_with_override' | 'decline';

const CHOICES: { value: Action; name: string; note: string }[] = [
  {
    value: 'approve',
    name: 'Approve at the worksheet price',
    note: 'Change any line below first; each change needs its reason.',
  },
  {
    value: 'approve_with_override',
    name: 'Approve in another risk class',
    note: 'The rate card prices it again in the class you choose.',
  },
  { value: 'decline', name: 'Decline', note: 'The customer is told; nothing is charged.' },
];

// The underwriter's decision. The worksheet lines can be adjusted only on a plain approval, which is also what the
// API accepts: a change of class prices the event again from the rate card instead.
export function DecisionForm({
  action,
  lines,
  pricedClass,
  hasPrice,
  idem,
}: {
  action: FormAction;
  /** The worksheet's adjustable lines (everything but the rate card line); empty when there is no worksheet. */
  lines: WorksheetLine[];
  pricedClass: string;
  hasPrice: boolean;
  idem: string;
}) {
  const { state, pending, onSubmit } = useServerForm(action);
  const [choice, setChoice] = useState<Action>(hasPrice ? 'approve' : 'approve_with_override');

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <input type="hidden" name="idem" value={idem} />
      <fieldset>
        <legend className="sr-only">Decision</legend>
        <div className="space-y-2">
          {CHOICES.map((option) => {
            const unavailable = option.value === 'approve' && !hasPrice;
            return (
              <label
                key={option.value}
                className="flex cursor-pointer items-start gap-3 rounded-control border border-line-strong bg-surface px-3.5 py-2.5 transition-colors duration-150 has-checked:border-brand has-checked:bg-brand-soft/60 has-disabled:cursor-not-allowed has-disabled:opacity-55"
              >
                <input
                  type="radio"
                  name="action"
                  value={option.value}
                  checked={choice === option.value}
                  disabled={unavailable}
                  onChange={() => setChoice(option.value)}
                  className="mt-1 accent-brand"
                />
                <span>
                  <span className="block text-[0.95rem] font-medium text-ink">{option.name}</span>
                  <span className="block text-[0.82rem] text-ink-faint">
                    {unavailable ? 'There is no rate card price to approve.' : option.note}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {choice === 'approve_with_override' ? (
        <Field label="Price it as" htmlFor="riskClass">
          <Select id="riskClass" name="riskClass" defaultValue={pricedClass === 'A' ? 'B' : 'A'}>
            {['A', 'B', 'C'].map((value) => (
              <option key={value} value={value}>
                Class {value}
                {value === pricedClass ? ' (as quoted)' : ''}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      {choice === 'approve' && lines.length > 0 ? (
        <fieldset className="rounded-control border border-line bg-sunken/40 p-3.5">
          <legend className="px-1 text-sm font-semibold text-ink">Adjust a worksheet line</legend>
          <ul className="space-y-3">
            {lines.map((line) => (
              <li key={line.id} className="grid grid-cols-[minmax(0,1fr)_6.5rem] items-end gap-2">
                <Field
                  label={`${line.factor} (now ${money(line.amountCents)})`}
                  htmlFor={`why-${line.id}`}
                >
                  <Input
                    id={`why-${line.id}`}
                    name={`why:${line.id}`}
                    placeholder="Reason for the change"
                    maxLength={500}
                    className="h-9 text-sm"
                  />
                </Field>
                <Input
                  aria-label={`New amount for ${line.factor}, in dollars`}
                  name={`line:${line.id}`}
                  type="number"
                  step="0.01"
                  placeholder="New $"
                  className="h-9 text-right text-sm"
                />
              </li>
            ))}
          </ul>
        </fieldset>
      ) : null}

      <Field label="Note for the file" htmlFor="note">
        <Textarea
          id="note"
          name="note"
          rows={3}
          required
          maxLength={2000}
          placeholder="What you checked and why you decided this way."
        />
      </Field>

      {state.error ? <Notice tone="danger">{state.error}</Notice> : null}

      <Button
        type="submit"
        variant={choice === 'decline' ? 'danger' : 'primary'}
        disabled={pending}
        aria-busy={pending}
        className="w-full"
      >
        {pending ? 'Recording…' : choice === 'decline' ? 'Decline the event' : 'Approve'}
      </Button>
    </form>
  );
}
