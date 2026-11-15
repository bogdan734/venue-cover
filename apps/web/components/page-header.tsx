import type { ReactNode } from 'react';

// The top of every console page: what the page is, and one sentence on what it is for. The rail already says which
// area this is.
export function PageHeader({
  title,
  children,
  actions,
}: {
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-7 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
      <div className="max-w-2xl">
        <h1 className="text-[2rem] text-ink">{title}</h1>
        {children ? <p className="mt-2 text-ink-soft">{children}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
