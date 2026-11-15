import { randomUUID } from 'node:crypto';
import { Check } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { cx } from '@/lib/cx';
import type { ProgramDetail, ProgramStatus } from '@/lib/types';
import { STATUS } from '@/lib/words';

function Move({
  action,
  to,
  label,
  variant = 'primary',
  disabled,
}: {
  action: (form: FormData) => Promise<void>;
  to: ProgramStatus;
  label: string;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="idem" value={randomUUID()} />
      <input type="hidden" name="to" value={to} />
      <Button type="submit" variant={variant} size="sm" disabled={disabled}>
        {label}
      </Button>
    </form>
  );
}

// From a row in the hub to a public portal: what is done, what is left, and the one move that comes next. A live
// program is paused rather than sent back, because its policies already exist.
export function Launch({
  program,
  move,
}: {
  program: ProgramDetail;
  move: (form: FormData) => Promise<void>;
}) {
  const { status } = program;
  const ready = program.theme !== null && program.contacts !== null;
  const steps = [
    {
      title: 'Terms and rules',
      done: true,
      note: `Version ${program.versions.length} in force; change them below from a letter.`,
    },
    {
      title: 'Appearance',
      done: program.theme !== null,
      note: 'Colour, logo and wording, checked for contrast.',
    },
    {
      title: 'Contacts',
      done: program.contacts !== null,
      note: 'Who renters reach, at the foot of every page.',
    },
    {
      title: 'Tried by staff',
      done: status !== 'draft',
      note: 'In test, the portal works for staff only: make a quote on it.',
    },
    {
      title: 'Open to the public',
      done: status === 'live' || status === 'paused',
      note: 'Listed on the front door, counted in the hub.',
    },
  ];

  return (
    <Card aria-label="Launch" className="mb-6">
      <CardHeader
        title="Launch"
        note={`${STATUS[status].word}: ${STATUS[status].portal}.`}
        aside={
          <>
            {status === 'draft' ? <Move action={move} to="test" label="Move to test" /> : null}
            {status === 'test' ? (
              <>
                <Move action={move} to="draft" label="Back to draft" variant="secondary" />
                <Move action={move} to="live" label="Open to the public" disabled={!ready} />
              </>
            ) : null}
            {status === 'live' ? (
              <Move action={move} to="paused" label="Pause new business" variant="danger" />
            ) : null}
            {status === 'paused' ? <Move action={move} to="live" label="Reopen" /> : null}
          </>
        }
      />
      <CardBody>
        <ol className="grid gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-5">
          {steps.map((step, i) => (
            <li key={step.title} className="flex gap-3">
              <span
                className={cx(
                  'flex size-6 shrink-0 items-center justify-center rounded-full text-[0.78rem] font-semibold',
                  step.done ? 'bg-ok text-white' : 'border border-line-strong text-ink-faint',
                )}
                aria-hidden
              >
                {step.done ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-[0.92rem] font-medium text-ink">
                  {step.title}
                  <span className="sr-only">{step.done ? ' (done)' : ' (to do)'}</span>
                </span>
                <span className="block text-[0.8rem] leading-snug text-ink-faint">{step.note}</span>
              </span>
            </li>
          ))}
        </ol>
        {status === 'test' && !ready ? (
          <p className="mt-4 text-sm text-ink-soft">
            <Badge tone="warn">Not yet</Badge> Set the appearance and the contacts before the portal
            opens.
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}
