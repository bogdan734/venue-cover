import { ArrowLeft, Inbox, UserRound } from 'lucide-react';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Image from 'next/image';
import Link from 'next/link';
import { after } from 'next/server';
import type { ReactNode } from 'react';
import { PortalChat } from '@/components/portal/chat';
import { PortalContacts } from '@/components/portal/contacts';
import { TelegramApp } from '@/components/portal/telegram-app';
import { buttonClass } from '@/components/ui/button';
import { api } from '@/lib/api';
import { isAdmin } from '@/lib/auth';
import { brandStyle } from '@/lib/brand';
import { portalOf } from '@/lib/portal';
import { visitorOf } from '@/lib/rate-limit';
import { currentRenter, hasInbox } from '@/lib/renter';
import type { Program } from '@/lib/types';
import { isBot, visitKey } from '@/lib/visits';

type Params = Promise<{ code: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { program } = await portalOf((await params).code);
  return { title: { default: program.name, template: `%s · ${program.name}` } };
}

// After the page is sent, so counting never slows it. Staff and crawlers are not visitors.
async function countVisit(program: Program, staff: boolean): Promise<void> {
  const request = await headers();
  if (program.status !== 'live' || staff || isBot(request.get('user-agent'))) return;
  const visitor = `${visitorOf(request)} ${request.get('user-agent')}`;
  const today = new Date().toISOString().slice(0, 10);
  const secret = process.env.VENUE_OPERATOR_KEY as string;
  after(() =>
    api({ program: program.id }, '/v1/visits', {
      method: 'POST',
      idempotencyKey: visitKey(secret, visitor, program.id, today),
    }).catch((error: unknown) => console.error('could not count a portal visit', error)),
  );
}

const STATUS_NOTE = {
  draft: 'a draft',
  test: 'in test',
} as const;

// What a renter sees: one program's portal, with none of the back office around it. The dark strip on top belongs to
// the demo, not to the portal.
export default async function PortalLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Params;
}) {
  const { program, as } = await portalOf((await params).code);
  const [staff, renter, inbox, channels] = await Promise.all([
    isAdmin(),
    currentRenter(as),
    hasInbox(),
    api<{ telegram: { username: string } | null }>(as, '/v1/channels'),
  ]);
  const bot = channels.telegram?.username ?? null;
  await countVisit(program, staff);
  const home = `/p/${program.code}`;
  const { theme } = program;
  return (
    <div className="flex min-h-dvh flex-col" style={brandStyle(theme)}>
      <div className="bg-ink text-[0.82rem] text-white/80">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-1 px-5 py-2">
          <span>
            Demo · this is the customer portal of program{' '}
            <span className="font-mono text-white">{program.code}</span>
          </span>
          <Link
            href={staff ? '/' : '/portals'}
            className="inline-flex items-center gap-1.5 text-white hover:underline"
          >
            <ArrowLeft className="size-3.5" aria-hidden />{' '}
            {staff ? 'Back to the console' : 'Other portals'}
          </Link>
        </div>
      </div>

      {program.status === 'draft' || program.status === 'test' ? (
        <div className="border-b border-warn/30 bg-warn-soft text-[0.85rem] text-warn">
          <p className="mx-auto max-w-5xl px-5 py-2">
            This portal is {STATUS_NOTE[program.status]}: only staff can see it.{' '}
            <Link href={`/programs/${program.id}`} className="font-medium underline">
              Open it to the public from the client page
            </Link>
            .
          </p>
        </div>
      ) : null}

      <header className="border-t-4 border-b border-t-brand border-b-line bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-5">
          <Link href={home} className="flex items-center gap-3.5">
            {theme?.logo ? (
              // A data URL the API checked; next/image leaves those as they are.
              <Image
                src={theme.logo}
                alt=""
                width={44}
                height={44}
                className="size-11 shrink-0 rounded-control object-contain"
              />
            ) : null}
            <span>
              <span className="block font-serif text-[1.45rem] leading-tight font-semibold text-ink">
                {program.name}
              </span>
              <span className="block text-sm text-ink-faint">
                {theme?.tagline ?? 'Event insurance for people renting our spaces'} · arranged
                through {program.brokerName}, {program.province}
              </span>
            </span>
          </Link>
          <nav aria-label="Your account" className="flex items-center gap-1.5 text-sm">
            {inbox ? (
              <Link href={`${home}/inbox`} className={buttonClass('quiet', 'sm')}>
                <Inbox className="size-4" aria-hidden /> Inbox
              </Link>
            ) : null}
            {renter ? (
              <Link href={`${home}/account`} className={buttonClass('secondary', 'sm')}>
                <UserRound className="size-4" aria-hidden />
                <span className="max-w-40 truncate">{renter.name}</span>
              </Link>
            ) : (
              <>
                <Link href={`${home}/account/sign-in`} className={buttonClass('quiet', 'sm')}>
                  Sign in
                </Link>
                <Link href={`${home}/account/register`} className={buttonClass('secondary', 'sm')}>
                  Create an account
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      {program.status === 'paused' ? (
        <div className="border-b border-line bg-sunken">
          <p role="status" className="mx-auto max-w-5xl px-5 py-3 text-[0.92rem] text-ink">
            {program.name} is not taking new bookings just now. Policies already issued stay in
            force, and your account and certificates are here as before.
          </p>
        </div>
      ) : null}

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-9">{children}</main>

      <footer className="border-t border-line">
        <div className="mx-auto max-w-5xl px-5 py-6">
          {program.contacts ? (
            <PortalContacts contacts={program.contacts} bot={bot} code={program.code} />
          ) : null}
          <p className="text-[0.8rem] text-ink-faint">
            Every name, rate and policy on this portal is invented. Payment is simulated: no card is
            charged and no e-mail is sent.
          </p>
        </div>
      </footer>
      <PortalChat code={program.code} name={program.name} telegram={bot} />
      <TelegramApp />
    </div>
  );
}
