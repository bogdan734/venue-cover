import { ArrowRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Lockup } from '@/components/mark';
import { TelegramApp } from '@/components/portal/telegram-app';
import { api } from '@/lib/api';
import { isOpen } from '@/lib/portal';
import type { Program, ProgramRules } from '@/lib/types';
import { PROVINCE, rulesInWords } from '@/lib/words';

export const metadata: Metadata = { title: 'Customer portals' };

// The public front door: who a renter is, and a portal for each client program. No password.
export default async function Portals() {
  const programs = (await api<{ programs: Program[] }>('operator', '/v1/programs')).programs.filter(
    isOpen,
  );
  const details = await Promise.all(
    programs.map((p) => api<{ rules: ProgramRules }>('operator', `/v1/programs/${p.id}`)),
  );
  return (
    <main className="mx-auto max-w-5xl px-5 py-12">
      <Lockup />
      <h1 className="mt-10 max-w-3xl text-[2.3rem] leading-[1.1] text-ink sm:text-[2.8rem]">
        Insure an event at a venue you are renting, in a few minutes.
      </h1>
      <p className="mt-4 max-w-2xl text-[1.05rem] text-ink-soft">
        Choose the organisation whose space you are renting. Describe your event in your own words;
        you see how it was read, get a price, pay with a simulated card and receive the policy and
        its certificates. Anything unusual goes to a person, with the reasons.
      </p>
      <ul className="mt-9 overflow-hidden rounded-card border border-line bg-surface">
        {programs.map((program, index) => (
          <li key={program.id} className="border-b border-line last:border-b-0">
            <Link
              href={`/p/${program.code}`}
              className="group grid items-center gap-x-8 gap-y-2 px-5 py-5 transition-colors duration-150 hover:bg-brand-soft/40 md:grid-cols-[minmax(0,19rem)_minmax(0,1fr)_auto]"
            >
              <span>
                <span className="block font-serif text-[1.25rem] leading-snug font-semibold text-ink">
                  {program.name}
                </span>
                <span className="block text-sm text-ink-faint">{PROVINCE[program.province]}</span>
              </span>
              <span className="text-[0.92rem] text-ink-soft">
                {rulesInWords(details[index]?.rules as ProgramRules).join(' · ')}
              </span>
              <span className="inline-flex items-center gap-1 text-sm font-medium whitespace-nowrap text-brand">
                Get a quote
                <ArrowRight
                  className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5"
                  aria-hidden
                />
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-10 text-sm text-ink-faint">
        Every name, rate and policy here is invented, and nothing is charged or sent.{' '}
        <Link href="/login" className="text-brand hover:underline">
          Staff sign-in
        </Link>
      </p>
      <TelegramApp />
    </main>
  );
}
