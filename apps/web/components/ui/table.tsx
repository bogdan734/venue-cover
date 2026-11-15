import type { ComponentProps, ReactNode } from 'react';
import { cx } from '@/lib/cx';

// Tables scroll sideways inside their own box on a narrow screen, so the page itself never does.
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className={cx('w-full border-collapse text-left text-[0.92rem]', className)}>
        {children}
      </table>
    </div>
  );
}

export function Th({
  children,
  numeric,
  className,
  ...props
}: ComponentProps<'th'> & { numeric?: boolean }) {
  return (
    <th
      scope="col"
      {...props}
      className={cx(
        'border-b border-line bg-sunken/50 px-4 py-2 text-[0.8rem] font-medium text-ink-faint whitespace-nowrap',
        numeric && 'text-right',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  numeric,
  className,
  ...props
}: ComponentProps<'td'> & { numeric?: boolean }) {
  return (
    <td
      {...props}
      className={cx(
        'border-b border-line px-4 py-2.5 align-top',
        numeric && 'text-right whitespace-nowrap',
        className,
      )}
    >
      {children}
    </td>
  );
}

// An identifier a person may want to copy: shown whole, in the mono face.
export function Code({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <code className={cx('font-mono text-[0.85rem] text-ink-soft', className)}>{children}</code>
  );
}
