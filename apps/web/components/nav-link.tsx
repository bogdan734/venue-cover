'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cx } from '@/lib/cx';

// A link on the console's dark rail that knows whether the visitor is in its area.
export function NavLink({
  href,
  icon,
  children,
  badge,
}: {
  href: string;
  icon: ReactNode;
  children: ReactNode;
  badge?: ReactNode;
}) {
  const pathname = usePathname();
  const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'flex h-9 items-center gap-2.5 rounded-control px-2.5 text-[0.93rem] transition-colors duration-150',
        active
          ? 'bg-white/12 font-semibold text-white'
          : 'text-white/70 hover:bg-white/7 hover:text-white',
      )}
    >
      <span className="shrink-0 [&>svg]:size-[1.05rem]" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {badge}
    </Link>
  );
}
