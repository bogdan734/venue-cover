import type { ComponentProps, ReactNode } from 'react';
import { cx } from '@/lib/cx';

export const controlClass =
  'w-full rounded-control border border-line-strong bg-surface px-3 text-ink placeholder:text-ink-faint transition-colors duration-150 hover:border-ink-faint focus:border-brand focus:outline-2 focus:outline-brand/25 disabled:bg-sunken';

// A labelled control. `htmlFor` is the id of the control inside, so clicking the label focuses it and a screen reader
// reads the label and the hint with it.
export function Field({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-ink-soft">
        {label}
      </label>
      {children}
      {hint ? (
        <p id={`${htmlFor}-hint`} className="mt-1 text-[0.8rem] text-ink-faint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input {...props} className={cx(controlClass, 'h-10', className)} />;
}

export function Select({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <select {...props} className={cx(controlClass, 'h-10 pr-8', className)}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea {...props} className={cx(controlClass, 'py-2.5 leading-relaxed', className)} />;
}
