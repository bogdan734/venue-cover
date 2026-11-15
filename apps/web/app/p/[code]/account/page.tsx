import { ChevronRight, Inbox, LogOut } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge, type Tone } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader, Empty, Label, Notice } from '@/components/ui/card';
import { api } from '@/lib/api';
import { day, money } from '@/lib/format';
import { portalOf } from '@/lib/portal';
import { currentRenter, hasInbox, type RenterQuote, sessionHeader } from '@/lib/renter';
import type { Program } from '@/lib/types';
import { signOut } from './actions';

export const metadata: Metadata = { title: 'Your account' };

function status(quote: RenterQuote): { tone: Tone; word: string } {
  if (quote.policy) return { tone: 'ok', word: `Policy ${quote.policy.policyNumber}` };
  switch (quote.state) {
    case 'quoted':
      return { tone: 'brand', word: 'Price ready' };
    case 'referred':
      return { tone: 'warn', word: 'With an underwriter' };
    case 'declined':
      return { tone: 'danger', word: 'Declined' };
    default:
      return { tone: 'neutral', word: 'Lapsed' };
  }
}

// One account across every portal on the platform: each quote links to the portal it was made on.
export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ welcome?: string }>;
}) {
  const { program, as } = await portalOf((await params).code);
  const renter = await currentRenter(as);
  if (!renter) {
    redirect(
      `/p/${program.code}/account/sign-in?next=${encodeURIComponent(`/p/${program.code}/account`)}`,
    );
  }
  const [{ quotes }, { programs }, inbox] = await Promise.all([
    api<{ quotes: RenterQuote[] }>(as, '/v1/renters/me/quotes', { headers: await sessionHeader() }),
    api<{ programs: Program[] }>('operator', '/v1/programs'),
    hasInbox(),
  ]);
  const portals = new Map(programs.map((p) => [p.id, p]));
  const welcome = (await searchParams).welcome === '1';

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_19rem]">
      <section aria-labelledby="account" className="space-y-6">
        <div>
          <h1 id="account" className="text-[2.1rem] text-ink">
            Hello, {renter.name}
          </h1>
          <p className="mt-2 text-ink-soft">Your quotes and policies, on every portal.</p>
        </div>
        {welcome ? (
          <Notice tone="ok">Your e-mail is confirmed and you are signed in.</Notice>
        ) : null}
        <Card aria-label="Your quotes and policies">
          <CardHeader title="Quotes and policies" note="Newest first." />
          {quotes.length === 0 ? (
            <Empty title="Nothing yet">
              <Link href={`/p/${program.code}`} className="font-medium text-brand hover:underline">
                Describe an event
              </Link>{' '}
              to get a price; it shows up here once you pay for it or ask for it signed in.
            </Empty>
          ) : (
            <ul className="divide-y divide-line">
              {quotes.map((quote) => {
                const portal = portals.get(quote.programId);
                const code = portal?.code ?? program.code;
                const { tone, word } = status(quote);
                const href = quote.policy
                  ? `/p/${code}/policy/${quote.policy.id}`
                  : `/p/${code}/quote/${quote.id}`;
                return (
                  <li key={quote.id}>
                    <Link
                      href={href}
                      className="group flex items-center gap-4 px-5 py-3.5 transition-colors duration-150 hover:bg-sunken/60"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-ink">{quote.activityTitle}</p>
                        <p className="mt-0.5 text-sm text-ink-faint">
                          {day(quote.eventDate)}
                          {portal && portal.id !== program.id ? ` · ${portal.name}` : null}
                        </p>
                      </div>
                      <Badge tone={tone}>{word}</Badge>
                      <span className="hidden w-24 text-right text-ink sm:block">
                        {quote.totalCents === null ? '—' : money(quote.totalCents)}
                      </span>
                      <ChevronRight
                        className="size-4 text-ink-faint transition-transform duration-150 group-hover:translate-x-0.5"
                        aria-hidden
                      />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </section>

      <aside className="space-y-4">
        <Card>
          <CardHeader title="Account" />
          <CardBody>
            <dl className="space-y-3 text-[0.95rem]">
              <div>
                <dt>
                  <Label>Name</Label>
                </dt>
                <dd className="mt-0.5 text-ink">{renter.name}</dd>
              </div>
              <div>
                <dt>
                  <Label>E-mail</Label>
                </dt>
                <dd className="mt-0.5 text-ink">
                  <span className="block [overflow-wrap:anywhere]">{renter.email}</span>
                  <Badge tone="ok" className="mt-1.5">
                    confirmed
                  </Badge>
                </dd>
              </div>
              <div>
                <dt>
                  <Label>Member since</Label>
                </dt>
                <dd className="mt-0.5 text-ink">{day(renter.createdAt)}</dd>
              </div>
            </dl>
            <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
              {inbox ? (
                <ButtonLink href={`/p/${program.code}/inbox`} variant="secondary" size="sm">
                  <Inbox className="size-4" aria-hidden /> Demo inbox
                </ButtonLink>
              ) : null}
              <form action={signOut.bind(null, program.code)}>
                <Button type="submit" variant="quiet" size="sm">
                  <LogOut className="size-4" aria-hidden /> Sign out
                </Button>
              </form>
            </div>
          </CardBody>
        </Card>
      </aside>
    </div>
  );
}
