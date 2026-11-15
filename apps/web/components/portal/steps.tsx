import { Check } from 'lucide-react';
import { cx } from '@/lib/cx';

const STEPS = ['Describe', 'Confirm', 'Price', 'Policy'] as const;

// Where the renter is on the way from a sentence to a policy.
export function Steps({ current }: { current: (typeof STEPS)[number] }) {
  const at = STEPS.indexOf(current);
  return (
    <ol aria-label="Steps" className="mb-8 flex items-center gap-x-2 text-sm">
      {STEPS.map((step, index) => (
        <li
          key={step}
          aria-current={index === at ? 'step' : undefined}
          className="flex items-center gap-2"
        >
          <span
            className={cx(
              'flex size-6 items-center justify-center rounded-full text-[0.78rem] font-medium',
              index < at && 'bg-ok-soft text-ok',
              index === at && 'bg-brand text-white',
              index > at && 'border border-line-strong text-ink-faint',
            )}
          >
            {index < at ? <Check className="size-3.5" aria-hidden /> : index + 1}
          </span>
          <span
            className={cx(
              index === at ? 'font-semibold text-ink' : 'text-ink-faint max-sm:sr-only',
            )}
          >
            {step}
          </span>
          {index < STEPS.length - 1 ? (
            <span className="mx-1 h-px w-5 bg-line-strong sm:w-10" aria-hidden />
          ) : null}
        </li>
      ))}
    </ol>
  );
}
