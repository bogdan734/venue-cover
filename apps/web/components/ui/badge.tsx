import type { ReactNode } from 'react';
import { cx } from '@/lib/cx';

export type Tone = 'neutral' | 'brand' | 'ok' | 'warn' | 'danger' | 'info';

const tones: Record<Tone, string> = {
  neutral: 'bg-sunken text-ink-soft',
  brand: 'bg-brand-soft text-brand-strong',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
  title,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[0.8rem] font-medium leading-5 whitespace-nowrap',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

// Risk classes run from A (benign) to C (needs care); X is not insurable without a person.
const CLASS_TONE: Record<string, Tone> = { A: 'ok', B: 'info', C: 'warn', X: 'danger' };
const CLASS_WORD: Record<string, string> = {
  A: 'low risk',
  B: 'moderate risk',
  C: 'higher risk',
  X: 'not insurable without review',
};

export function RiskClass({ value }: { value: string | null }) {
  if (!value) return <Badge>no class</Badge>;
  return (
    <Badge tone={CLASS_TONE[value] ?? 'neutral'} title={CLASS_WORD[value]}>
      Class {value}
    </Badge>
  );
}
