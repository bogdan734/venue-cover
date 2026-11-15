import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { cx } from '@/lib/cx';

type Variant = 'primary' | 'secondary' | 'quiet' | 'danger';
type Size = 'md' | 'sm';

const base =
  'inline-flex items-center justify-center gap-2 rounded-control font-medium whitespace-nowrap transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-55';
const variants: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-strong',
  secondary: 'border border-line-strong bg-surface text-ink hover:bg-sunken',
  quiet: 'text-brand hover:bg-brand-soft',
  danger: 'border border-danger/30 bg-surface text-danger hover:bg-danger-soft',
};
const sizes: Record<Size, string> = { md: 'h-10 px-4 text-[0.95rem]', sm: 'h-8 px-3 text-sm' };

export const buttonClass = (variant: Variant = 'primary', size: Size = 'md', extra?: string) =>
  cx(base, variants[variant], sizes[size], extra);

export function Button({
  variant,
  size,
  className,
  ...props
}: ComponentProps<'button'> & { variant?: Variant; size?: Size }) {
  return <button {...props} className={buttonClass(variant, size, className)} />;
}

export function ButtonLink({
  href,
  variant,
  size,
  className,
  children,
  ...props
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
} & Omit<ComponentProps<typeof Link>, 'href' | 'className'>) {
  return (
    <Link href={href} {...props} className={buttonClass(variant, size, className)}>
      {children}
    </Link>
  );
}
