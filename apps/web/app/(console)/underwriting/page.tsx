import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Badge, RiskClass, type Tone } from '@/components/ui/badge';
import { Card, Empty } from '@/components/ui/card';
import { Table, Td, Th } from '@/components/ui/table';
import { api } from '@/lib/api';
import { cx } from '@/lib/cx';
import { count, day, money, relative } from '@/lib/format';
import type { Program, Referral } from '@/lib/types';
import { REASONS } from '@/lib/words';

export const metadata: Metadata = { title: 'Underwriting' };

const SLA_TONE: Record<string, Tone> = { ok: 'neutral', due_soon: 'warn', overdue: 'danger' };
const OUTCOME: Record<string, { word: string; tone: Tone }> = {
  approve: { word: 'Approved', tone: 'ok' },
  approve_with_override: { word: 'Approved, class changed', tone: 'info' },
  decline: { word: 'Declined', tone: 'danger' },
};

export default async function Underwriting({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const decided = (await searchParams).view === 'decided';
  const [{ referrals }, { programs }] = await Promise.all([
    api<{ referrals: Referral[] }>(
      'operator',
      decided ? '/v1/referrals?state=decided' : '/v1/referrals',
    ),
    api<{ programs: Program[] }>('operator', '/v1/programs'),
  ]);
  const codeOf = new Map(programs.map((p) => [p.id, p.code]));
  const now = new Date();

  return (
    <>
      <PageHeader title="Referrals">
        Events the rules would not price unseen, soonest deadline first. Each one arrives with the
        reasons, a worksheet and the nearest past decisions.
      </PageHeader>

      <nav aria-label="Views" className="mb-4 flex gap-1 border-b border-line">
        {[
          { href: '/underwriting', name: 'Waiting', on: !decided },
          { href: '/underwriting?view=decided', name: 'Decided', on: decided },
        ].map((tab) => (
          <Link
            key={tab.name}
            href={tab.href}
            aria-current={tab.on ? 'page' : undefined}
            className={cx(
              '-mb-px border-b-2 px-3.5 py-2 text-[0.95rem] transition-colors duration-150',
              tab.on
                ? 'border-brand font-semibold text-brand-strong'
                : 'border-transparent text-ink-soft hover:text-ink',
            )}
          >
            {tab.name}
          </Link>
        ))}
      </nav>

      <Card>
        {referrals.length === 0 ? (
          <Empty title={decided ? 'Nothing has been decided yet' : 'The queue is empty'}>
            {decided
              ? 'Decisions appear here, and become the comparables for later referrals.'
              : 'Describe a contact sport, fireworks or a very large crowd on a portal, and it will land here.'}
          </Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{decided ? 'Decided' : 'Due'}</Th>
                <Th>Event</Th>
                <Th>Class</Th>
                <Th>Why it is here</Th>
                <Th numeric>{decided ? 'Price' : 'Indicative'}</Th>
                <Th>{decided ? 'Outcome' : 'Status'}</Th>
              </tr>
            </thead>
            <tbody>
              {referrals.map((referral) => {
                const outcome = referral.decision ? OUTCOME[referral.decision.action] : undefined;
                return (
                  <tr
                    key={referral.id}
                    className="transition-colors duration-150 hover:bg-sunken/40"
                  >
                    <Td className="whitespace-nowrap">
                      {decided && referral.decidedAt ? (
                        <span className="text-ink-soft">{relative(referral.decidedAt, now)}</span>
                      ) : (
                        <Badge tone={SLA_TONE[referral.sla ?? 'ok']}>
                          {relative(referral.dueAt, now)}
                        </Badge>
                      )}
                    </Td>
                    <Td>
                      <Link
                        href={`/underwriting/${referral.id}`}
                        className="font-medium text-brand hover:text-brand-strong hover:underline"
                      >
                        {referral.activity.title}
                      </Link>
                      <span className="block text-[0.85rem] text-ink-faint">
                        <span className="font-mono text-[0.78rem]">
                          {codeOf.get(referral.programId)}
                        </span>{' '}
                        · {count(referral.quote.input.participants)} people ·{' '}
                        {referral.quote.input.hours} h · {day(referral.quote.input.eventDate)}
                      </span>
                    </Td>
                    <Td>
                      <RiskClass value={referral.quote.input.pricedClass} />
                    </Td>
                    <Td>
                      <span className="flex flex-wrap gap-1">
                        {referral.reasons.map((reason) => (
                          <Badge key={reason} tone="warn" title={REASONS[reason].detail}>
                            {REASONS[reason].title}
                          </Badge>
                        ))}
                      </span>
                    </Td>
                    <Td numeric>
                      {referral.quote.premium ? money(referral.quote.premium.totalCents) : '—'}
                    </Td>
                    <Td className="whitespace-nowrap">
                      {outcome ? (
                        <Badge tone={outcome.tone}>{outcome.word}</Badge>
                      ) : referral.state === 'claimed' ? (
                        <Badge tone="brand">Taken</Badge>
                      ) : (
                        <Badge>Open</Badge>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
