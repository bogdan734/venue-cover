'use client';

import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { type FormAction, useServerForm } from '@/components/use-server-form';

// Payment is simulated, so instead of a card number the renter picks how the pretend card behaves. Each choice is a
// test token of the simulated provider, the way a real provider publishes test cards.
const CARDS = [
  { token: 'tok_ok', name: 'A card that is approved', note: 'The usual case.' },
  {
    token: 'tok_declined',
    name: 'A card that is declined',
    note: 'Nothing is charged; the quote stays open.',
  },
];

export function PayForm({
  action,
  total,
  idem,
}: {
  action: FormAction;
  total: string;
  idem: string;
}) {
  const { state, pending, onSubmit } = useServerForm(action);
  return (
    <form onSubmit={onSubmit}>
      <input type="hidden" name="idem" value={idem} />
      <fieldset>
        <legend className="text-sm font-medium text-ink-soft">Pay with a test card</legend>
        <div className="mt-2 space-y-2">
          {CARDS.map((card, index) => (
            <label
              key={card.token}
              className="flex cursor-pointer items-start gap-3 rounded-control border border-line-strong bg-surface px-3.5 py-2.5 transition-colors duration-150 has-checked:border-brand has-checked:bg-brand-soft/60"
            >
              <input
                type="radio"
                name="card"
                value={card.token}
                defaultChecked={index === 0}
                className="mt-1 accent-brand"
              />
              <span>
                <span className="block text-[0.95rem] font-medium text-ink">{card.name}</span>
                <span className="block text-[0.82rem] text-ink-faint">{card.note}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {state.error ? (
        <div className="mt-3">
          <Notice tone="danger">{state.error}</Notice>
        </div>
      ) : null}

      <Button type="submit" disabled={pending} aria-busy={pending} className="mt-4 w-full">
        {pending ? 'Paying…' : `Pay ${total} and issue the policy`}
      </Button>
    </form>
  );
}
