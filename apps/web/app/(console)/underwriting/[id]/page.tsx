import { randomUUID } from 'node:crypto';
import { ArrowLeft, ArrowUpRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { DecisionForm } from '@/components/desk/decision-form';
import { TakeButton } from '@/components/desk/take-button';
import { PageHeader } from '@/components/page-header';
import { PremiumSplit } from '@/components/premium-split';
import { ReasonList, Trace } from '@/components/trace';
import { Badge, RiskClass, type Tone } from '@/components/ui/badge';
import { Card, CardBody, CardHeader, Empty, Label, Notice } from '@/components/ui/card';
import { Code, Table, Td, Th } from '@/components/ui/table';
import { ApiError, api } from '@/lib/api';
import { count, day, limit, money, relative, stamp } from '@/lib/format';
import type { Program, ReferralDetail, Worksheet } from '@/lib/types';
import { ALCOHOL } from '@/lib/words';
import { decide, take } from '../actions';

export const metadata: Metadata = { title: 'Referral' };

const OUTCOME: Record<string, { word: string; tone: Tone }> = {
  approve: { word: 'Approved', tone: 'ok' },
  approve_with_override: { word: 'Approved, class changed', tone: 'info' },
  decline: { word: 'Declined', tone: 'danger' },
};

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

export default async function ReferralPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let referral: ReferralDetail;
  try {
    referral = await api<ReferralDetail>('operator', `/v1/referrals/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const [me, { programs }] = await Promise.all([
    api<{ keyId: string }>('operator', '/v1/me'),
    api<{ programs: Program[] }>('operator', '/v1/programs'),
  ]);
  // A quote the rate card could not price has no worksheet; the page says so instead of failing.
  let worksheet: Worksheet | null = null;
  let noWorksheet = '';
  try {
    worksheet = await api<Worksheet>('operator', `/v1/referrals/${id}/worksheet`);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    noWorksheet = error.message;
  }

  // Once decided, the worksheet on file is the one the underwriter signed off, with their changes and reasons; a fresh
  // one would start again from the price they set.
  const decided = referral.decision?.worksheet;
  if (worksheet && decided) {
    worksheet = {
      ...worksheet,
      lines: decided,
      netTotalCents: decided.reduce((sum, line) => sum + line.amountCents, 0),
      proposed: referral.quote.premium ?? worksheet.proposed,
    };
  }

  const program = programs.find((p) => p.id === referral.programId);
  const { quote } = referral;
  const mine = referral.state === 'claimed' && referral.claimedBy === me.keyId;
  const outcome = referral.decision ? OUTCOME[referral.decision.action] : undefined;
  const now = new Date();

  return (
    <>
      <Link
        href="/underwriting"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink"
      >
        <ArrowLeft className="size-3.5" aria-hidden /> All referrals
      </Link>
      <PageHeader
        title={referral.activity.title}
        actions={
          <>
            <RiskClass value={quote.input.pricedClass} />
            {outcome ? (
              <Badge tone={outcome.tone}>{outcome.word}</Badge>
            ) : (
              <Badge
                tone={
                  referral.sla === 'overdue'
                    ? 'danger'
                    : referral.sla === 'due_soon'
                      ? 'warn'
                      : 'neutral'
                }
              >
                due {relative(referral.dueAt, now)}
              </Badge>
            )}
          </>
        }
      >
        {program?.name} · {count(quote.input.participants)} people · {quote.input.hours} hours ·{' '}
        {day(quote.input.eventDate)}
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="min-w-0 space-y-6">
          <Card aria-label="Why it is here">
            <CardHeader title="Why it is here" note="Most serious first." />
            <CardBody>
              <ReasonList reasons={referral.reasons} />
            </CardBody>
          </Card>

          <Card aria-label="How the description was read">
            <CardHeader title="How the description was read" />
            <CardBody>
              {referral.classification ? (
                <Trace read={referral.classification} />
              ) : (
                <p className="text-ink-soft">
                  This quote was made by choosing the activity from the catalogue, so there is no
                  description to show.
                </p>
              )}
            </CardBody>
          </Card>

          <Card aria-label="Pricing worksheet">
            <CardHeader
              title="Pricing worksheet"
              note="The rate card premium, then one line per risk factor with how it was worked out."
            />
            {worksheet ? (
              <>
                <Table>
                  <thead>
                    <tr>
                      <Th>Factor</Th>
                      <Th className="hidden sm:table-cell">Basis</Th>
                      <Th numeric>Net amount</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {worksheet.lines.map((line) => (
                      <tr key={line.id}>
                        <Td className="font-medium sm:whitespace-nowrap">
                          {line.factor}
                          <span className="mt-0.5 block text-[0.88rem] font-normal text-ink-soft sm:hidden">
                            {line.basis}
                            {line.note ? (
                              <span className="mt-0.5 block text-info">Changed: {line.note}</span>
                            ) : null}
                          </span>
                        </Td>
                        <Td className="hidden text-ink-soft sm:table-cell">
                          {line.basis}
                          {line.note ? (
                            <span className="mt-0.5 block text-info">Changed: {line.note}</span>
                          ) : null}
                        </Td>
                        <Td numeric>
                          {line.editedFromCents === undefined ? null : (
                            <span className="mr-2 text-ink-faint line-through">
                              {money(line.editedFromCents)}
                            </span>
                          )}
                          {money(line.amountCents)}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <Td className="border-b-0 font-semibold" colSpan={2}>
                        Net premium
                      </Td>
                      <Td numeric className="border-b-0 font-medium text-ink">
                        {money(worksheet.netTotalCents)}
                      </Td>
                    </tr>
                  </tfoot>
                </Table>
                <div className="border-t border-line px-5 py-4">
                  <Label>What the customer would pay at this net premium</Label>
                  <div className="mt-3">
                    <PremiumSplit premium={worksheet.proposed} />
                  </div>
                </div>
              </>
            ) : (
              <CardBody>
                <Notice tone="warn">No worksheet: {noWorksheet}</Notice>
              </CardBody>
            )}
          </Card>

          <Card aria-label="Nearest past decisions">
            <CardHeader
              title="Nearest past decisions"
              note="Decided referrals most like this one, by activity, class, crowd and length."
            />
            {worksheet && worksheet.comparables.length > 0 ? (
              <Table>
                <thead>
                  <tr>
                    <Th>Event</Th>
                    <Th>Class</Th>
                    <Th numeric>People</Th>
                    <Th numeric>Hours</Th>
                    <Th>Decision</Th>
                    <Th numeric>Price</Th>
                  </tr>
                </thead>
                <tbody>
                  {worksheet.comparables.map((comparable) => (
                    <tr key={comparable.quoteId}>
                      <Td>
                        {comparable.activityTitle}
                        <span className="block text-[0.82rem] text-ink-faint">
                          {relative(comparable.decidedAt, now)}
                        </span>
                      </Td>
                      <Td>
                        <RiskClass value={comparable.riskClass} />
                      </Td>
                      <Td numeric>{count(comparable.participants)}</Td>
                      <Td numeric>{comparable.hours}</Td>
                      <Td>
                        <Badge tone={OUTCOME[comparable.action]?.tone}>
                          {OUTCOME[comparable.action]?.word}
                        </Badge>
                      </Td>
                      <Td numeric>
                        {comparable.totalCents === null ? '—' : money(comparable.totalCents)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <Empty title="No comparable decisions yet">
                Every decision made here becomes a comparable for the next referral like it.
              </Empty>
            )}
          </Card>
        </div>

        <aside className="space-y-6">
          <Card aria-label="Decision" className="lg:sticky lg:top-6">
            <CardHeader title="Decision" />
            <CardBody>
              {referral.decision && outcome ? (
                <div className="space-y-3">
                  <p>
                    <Badge tone={outcome.tone}>{outcome.word}</Badge>
                    <span className="ml-2 text-sm text-ink-faint">
                      {referral.decidedAt ? stamp(referral.decidedAt) : null}
                    </span>
                  </p>
                  <p className="text-ink-soft">“{referral.decision.note}”</p>
                  {quote.premium && referral.decision.action !== 'decline' ? (
                    <p>
                      <Label>The customer’s price</Label>
                      <span className="mt-0.5 block text-[1.5rem] font-semibold tracking-[-0.01em]">
                        {money(quote.premium.totalCents)}
                      </span>
                    </p>
                  ) : null}
                </div>
              ) : mine ? (
                <DecisionForm
                  action={decide.bind(null, referral.id)}
                  lines={(worksheet?.lines ?? []).filter((line) => line.id !== 'base')}
                  pricedClass={quote.input.pricedClass}
                  hasPrice={quote.premium !== null}
                  idem={randomUUID()}
                />
              ) : referral.state === 'claimed' ? (
                <Notice tone="info">Another underwriter has taken this referral.</Notice>
              ) : (
                <>
                  <p className="mb-3 text-[0.92rem] text-ink-soft">
                    Take it to decide it. Only one underwriter can hold a referral at a time.
                  </p>
                  <TakeButton take={take.bind(null, referral.id)} />
                </>
              )}
            </CardBody>
          </Card>

          <Card aria-label="The request">
            <CardHeader title="The request" />
            <CardBody>
              <dl className="grid grid-cols-2 gap-x-5 gap-y-4 text-[0.92rem]">
                <Detail label="Insured">{quote.holder.name}</Detail>
                <Detail label="Alcohol">{ALCOHOL[quote.input.alcohol]}</Detail>
                <Detail label="Limit">{limit(quote.input.limitCents)}</Detail>
                <Detail label="Starts">{quote.input.startTime}</Detail>
                <Detail label="Received">{relative(referral.createdAt, now)}</Detail>
                <Detail label="Quote">
                  <Code>{quote.id}</Code>
                </Detail>
              </dl>
              {program ? (
                <Link
                  href={`/p/${program.code}/quote/${quote.id}`}
                  className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand hover:text-brand-strong"
                >
                  What the customer sees <ArrowUpRight className="size-3.5" aria-hidden />
                </Link>
              ) : null}
            </CardBody>
          </Card>
        </aside>
      </div>
    </>
  );
}
