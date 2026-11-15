import {
  ArrowUpRight,
  Building2,
  Compass,
  Gauge,
  Inbox,
  MessagesSquare,
  Webhook,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { logout } from '@/app/login/actions';
import { Mark } from '@/components/mark';
import { NavLink } from '@/components/nav-link';
import { api } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { authMode } from '@/lib/session';
import type { InboxItem, Program } from '@/lib/types';

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  await requireAdmin();
  const [{ programs }, { referrals }, { conversations }] = await Promise.all([
    api<{ programs: Program[] }>('operator', '/v1/programs'),
    api<{ referrals: { id: string }[] }>('operator', '/v1/referrals'),
    api<{ conversations: InboxItem[] }>('operator', '/v1/inbox'),
  ]);
  const waiting = conversations.filter((c) => c.state === 'waiting').length;

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15.5rem_minmax(0,1fr)]">
      <aside className="flex flex-col bg-rail text-white lg:sticky lg:top-0 lg:h-dvh [&_:focus-visible]:outline-white">
        <Link href="/" className="flex items-center gap-3 px-5 pt-5 pb-4">
          <Mark onRail />
          <span className="leading-tight">
            <span className="block font-serif text-[1.1rem] font-semibold text-white">
              Venue Cover
            </span>
            <span className="block text-[0.78rem] text-white/60">event liability, end to end</span>
          </span>
        </Link>

        <nav
          aria-label="Areas"
          className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible"
        >
          <NavLink href="/" icon={<Compass />}>
            Tour
          </NavLink>
          <NavLink
            href="/underwriting"
            icon={<Inbox />}
            badge={
              referrals.length > 0 ? (
                <span
                  className="min-w-5 rounded-full bg-gold px-1.5 text-center text-[0.75rem] leading-5 font-semibold text-rail"
                  title="Referrals waiting for a person"
                >
                  {referrals.length}
                </span>
              ) : null
            }
          >
            Underwriting
          </NavLink>
          <NavLink
            href="/inbox"
            icon={<MessagesSquare />}
            badge={
              waiting > 0 ? (
                <span
                  className="min-w-5 rounded-full bg-gold px-1.5 text-center text-[0.75rem] leading-5 font-semibold text-rail"
                  title="Conversations waiting for a person"
                >
                  {waiting}
                </span>
              ) : null
            }
          >
            Inbox
          </NavLink>
          <NavLink href="/programs" icon={<Building2 />}>
            Programs
          </NavLink>
          <NavLink href="/developer" icon={<Webhook />}>
            Developer
          </NavLink>
          <NavLink href="/quality" icon={<Gauge />}>
            Quality
          </NavLink>
        </nav>

        <div className="hidden min-h-0 flex-1 flex-col lg:flex">
          <p className="mt-3 border-t border-white/10 px-5 pt-4 pb-1.5 text-[0.8rem] font-medium text-white/60">
            Client portals
          </p>
          <ul className="overflow-y-auto px-3">
            {programs.map((program) => (
              <li key={program.id}>
                <Link
                  href={`/p/${program.code}`}
                  className="group flex h-9 items-center gap-2.5 rounded-control px-2.5 text-[0.9rem] text-white/70 transition-colors duration-150 hover:bg-white/7 hover:text-white"
                >
                  <span className="w-9 shrink-0 font-mono text-[0.75rem] text-white/55">
                    {program.code}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{program.name}</span>
                  <ArrowUpRight
                    className="size-3.5 shrink-0 text-white/60 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                    aria-hidden
                  />
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-auto">
            {authMode({
              ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
              NODE_ENV: process.env.NODE_ENV,
            }) === 'password' ? (
              <form action={logout} className="px-5 pb-3">
                <button
                  type="submit"
                  className="text-sm text-white/70 hover:text-white hover:underline"
                >
                  Sign out
                </button>
              </form>
            ) : null}
            <p className="mt-auto border-t border-white/10 px-5 py-4 text-[0.78rem] leading-relaxed text-white/60">
              Every name, rate and figure here is invented. Payment and e-mail are simulated.
            </p>
          </div>
        </div>
      </aside>

      <main className="min-w-0 px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
        <div className="mx-auto max-w-[72rem]">{children}</div>
      </main>
    </div>
  );
}
