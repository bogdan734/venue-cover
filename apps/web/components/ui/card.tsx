import type { ReactNode } from 'react';
import { cx } from '@/lib/cx';

export function Card({
  children,
  className,
  as: Tag = 'section',
  ...props
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article' | 'aside';
  'aria-label'?: string;
  'data-testid'?: string;
}) {
  return (
    <Tag {...props} className={cx('rise rounded-card border border-line bg-surface', className)}>
      {children}
    </Tag>
  );
}

// The strip at the top of a card: what it is, and anything that belongs beside the title.
export function CardHeader({
  title,
  note,
  aside,
}: {
  title: ReactNode;
  note?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-line px-5 py-3.5">
      <div className="min-w-0">
        <h3 className="text-[0.95rem] font-semibold text-ink">{title}</h3>
        {note ? <p className="mt-0.5 text-sm text-ink-faint">{note}</p> : null}
      </div>
      {aside ? <div className="flex shrink-0 items-center gap-2">{aside}</div> : null}
    </header>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('px-5 py-4', className)}>{children}</div>;
}

// A small label above a value: the quiet way to name a figure.
export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cx('text-[0.8rem] font-medium text-ink-faint', className)}>{children}</span>
  );
}

export function Stat({
  label,
  value,
  note,
}: {
  label: ReactNode;
  value: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <Label>{label}</Label>
      <div className="mt-0.5 text-[1.5rem] leading-tight font-semibold tracking-[-0.01em] text-ink">
        {value}
      </div>
      {note ? <div className="mt-1 text-sm text-ink-faint">{note}</div> : null}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="font-medium text-ink">{title}</p>
      {children ? (
        <div className="mx-auto mt-1.5 max-w-md text-sm text-ink-faint">{children}</div>
      ) : null}
    </div>
  );
}

// A message that something went wrong, or right, next to what caused it.
export function Notice({
  tone,
  children,
}: {
  tone: 'danger' | 'warn' | 'ok' | 'info';
  children: ReactNode;
}) {
  const tones = {
    danger: 'border-danger/30 bg-danger-soft text-danger',
    warn: 'border-warn/30 bg-warn-soft text-warn',
    ok: 'border-ok/30 bg-ok-soft text-ok',
    info: 'border-info/30 bg-info-soft text-info',
  };
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cx('rounded-control border px-3.5 py-2.5 text-sm', tones[tone])}
    >
      {children}
    </div>
  );
}
