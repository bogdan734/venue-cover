import { randomUUID } from 'node:crypto';
import { Clock, ShieldX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AutoRefresh } from '@/components/auto-refresh';
import { PayForm } from '@/components/portal/pay-form';
import { Steps } from '@/components/portal/steps';
import { PremiumSplit } from '@/components/premium-split';
import { ReasonList } from '@/components/trace';
import { RiskClass } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader, Label } from '@/components/ui/card';
import { ApiError, gql } from '@/lib/api';
import { isAdmin } from '@/lib/auth';
import { count, day, limit, money, stamp } from '@/lib/format';
import { portalOf } from '@/lib/portal';
import { currentRenter } from '@/lib/renter';
import type { PremiumBreakdown, Quote, ReferralReason } from '@/lib/types';
import { ALCOHOL } from '@/lib/words';
import { pay } from '../../actions';

export const metadata: Metadata = { title: 'Your price' };

// Everything this page shows, in one round trip: the quote with its activity, its referral and its policy.
const QUERY = /* GraphQL */ `
  query QuotePage($id: ID!) {
    quote(id: $id) {
      id
      state
      expiresAt
      referralReasons
      input
      holder { name email }
      premium { netCents commissionCents marginCents feeCents taxCents totalCents rateRowId }
      activity { title riskClass }
      policy { id }
      referral { id dueAt }
    }
  }
`;

interface QuotePage {
  id: string;
  state: Quote['state'];
  expiresAt: string;
  referralReasons: ReferralReason[];
  input: Quote['input'];
  holder: Quote['holder'];
  premium: PremiumBreakdown | null;
  activity: { title: string; riskClass: string };
  policy: { id: string } | null;
  referral: { id: string; dueAt: string } | null;
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>
        <Label>{label}</Label>
      </dt>
      <dd className="mt-0.5 text-ink">{children}</dd>
    </div>
  );
}

function EventSummary({ quote }: { quote: QuotePage }) {
  const { input } = quote;
  return (
    <Card>
      <CardHeader title="Your event" aside={<RiskClass value={input.pricedClass} />} />
      <CardBody>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-[0.95rem]">
          <Detail label="Activity">{quote.activity.title}</Detail>
          <Detail label="When">
            {day(input.eventDate)}, {input.startTime}
          </Detail>
          <Detail label="People">{count(input.participants)}</Detail>
          <Detail label="Length">{input.hours} hours</Detail>
          <Detail label="Alcohol">{ALCOHOL[input.alcohol]}</Detail>
          <Detail label="Liability limit">{limit(input.limitCents)}</Detail>
          <Detail label="Insured">{quote.holder.name}</Detail>
          <Detail label="Reference">
            <span className="font-mono text-[0.85rem]">{quote.id}</span>
          </Detail>
        </dl>
      </CardBody>
    </Card>
  );
}

// The policy and its certificates go to a confirmed address, so paying needs an account. The price waits meanwhile.
function SignInFirst({ code, quoteId }: { code: string; quoteId: string }) {
  const next = encodeURIComponent(`/p/${code}/quote/${quoteId}`);
  return (
    <div>
      <p className="text-[0.95rem] text-ink-soft">
        To pay, sign in or create an account. It takes a minute, and this price waits for you.
      </p>
      <div className="mt-4 grid gap-2">
        <ButtonLink href={`/p/${code}/account/register?next=${next}`}>Create an account</ButtonLink>
        <ButtonLink href={`/p/${code}/account/sign-in?next=${next}`} variant="secondary">
          Sign in
        </ButtonLink>
      </div>
    </div>
  );
}

export default async function QuotePage({
  params,
}: {
  params: Promise<{ code: string; id: string }>;
}) {
  const { code, id } = await params;
  const { program, as } = await portalOf(code);
  const [staff, renter] = await Promise.all([isAdmin(), currentRenter(as)]);
  let quote: QuotePage | null;
  try {
    ({ quote } = await gql<{ quote: QuotePage | null }>(as, QUERY, { id }));
  } catch (error) {
    if (error instanceof ApiError && error.code === 'quote_not_found') notFound();
    throw error;
  }
  if (!quote) notFound();
  if (quote.policy) redirect(`/p/${program.code}/policy/${quote.policy.id}`);

  if (quote.state === 'quoted' && quote.premium) {
    return (
      <>
        <Steps current="Price" />
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_23rem]">
          <section aria-labelledby="price" className="space-y-6">
            <div>
              <h1 id="price" className="text-[2.1rem] text-ink">
                Your price is {money(quote.premium.totalCents)}
              </h1>
              <p className="mt-2 text-ink-soft">
                It holds until {stamp(quote.expiresAt)}. Nothing needed a person, so the policy is
                issued as soon as it is paid for.
              </p>
            </div>
            <Card aria-label="Where the premium goes">
              <CardHeader
                title="Where the premium goes"
                note="The same split an insurer, a broker and a province would see."
              />
              <CardBody>
                <PremiumSplit premium={quote.premium} />
              </CardBody>
            </Card>
            <EventSummary quote={quote} />
          </section>
          <aside>
            <Card className="lg:sticky lg:top-6">
              <CardHeader title="Payment" note="Simulated: no card is charged." />
              <CardBody>
                {renter ? (
                  <PayForm
                    action={pay.bind(null, program.code, quote.id)}
                    total={money(quote.premium.totalCents)}
                    idem={randomUUID()}
                  />
                ) : (
                  <SignInFirst code={program.code} quoteId={quote.id} />
                )}
              </CardBody>
            </Card>
          </aside>
        </div>
      </>
    );
  }

  if (quote.state === 'referred') {
    return (
      <>
        <Steps current="Price" />
        <AutoRefresh />
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_23rem]">
          <section aria-labelledby="review" className="space-y-6">
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold text-warn">
                <Clock className="size-4" aria-hidden /> With an underwriter
              </p>
              <h1 id="review" className="mt-1.5 text-[2.1rem] text-ink">
                A person is looking at your event
              </h1>
              <p className="mt-2 max-w-xl text-ink-soft">
                {quote.referral ? `They aim to answer by ${stamp(quote.referral.dueAt)}. ` : null}
                This page updates by itself when they decide; you do not need to send anything
                again.
              </p>
            </div>
            <Card>
              <CardHeader title="Why it was not priced automatically" />
              <CardBody>
                <ReasonList reasons={quote.referralReasons} />
              </CardBody>
            </Card>
            <EventSummary quote={quote} />
          </section>
          <aside className="space-y-4">
            <Card aria-label="Indicative price" className="p-5">
              <Label>Indicative price</Label>
              <p className="mt-0.5 text-[1.5rem] font-semibold tracking-[-0.01em] text-ink">
                {quote.premium ? money(quote.premium.totalCents) : 'To be worked out'}
              </p>
              <p className="mt-1 text-sm text-ink-faint">
                {quote.premium
                  ? 'From the rate card. The underwriter may change it.'
                  : 'The rate card has no price for this; the underwriter sets one.'}
              </p>
            </Card>
            {quote.referral && staff ? (
              <Card className="border-dashed p-5">
                <Label>In the demo</Label>
                <p className="mt-2 text-[0.92rem] text-ink-soft">
                  You can play the underwriter too: decide this referral and watch this page change.
                </p>
                <ButtonLink
                  href={`/underwriting/${quote.referral.id}`}
                  variant="secondary"
                  size="sm"
                  className="mt-3"
                >
                  Open it on the underwriting desk
                </ButtonLink>
              </Card>
            ) : null}
          </aside>
        </div>
      </>
    );
  }

  const lapsed = quote.state === 'expired';
  return (
    <>
      <Steps current="Price" />
      <section className="max-w-xl">
        <p className="flex items-center gap-2 text-sm font-semibold text-danger">
          <ShieldX className="size-4" aria-hidden />
          {lapsed ? 'Lapsed' : 'Declined'}
        </p>
        <h1 className="mt-1.5 text-[2.1rem] text-ink">
          {lapsed ? 'This price has lapsed' : 'We cannot offer cover for this event'}
        </h1>
        <p className="mt-2 text-ink-soft">
          {lapsed
            ? 'A price holds for a limited time. Describe the event again to get a current one.'
            : 'An underwriter reviewed it and declined. Nothing was charged. If the plans change, you are welcome to describe the event again.'}
        </p>
        <Link
          href={`/p/${program.code}`}
          className="mt-5 inline-block font-medium text-brand hover:underline"
        >
          Describe an event
        </Link>
      </section>
    </>
  );
}
