import { ArrowUpRight, Download } from 'lucide-react';
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { Sparkline } from '@/components/hub/sparkline';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader, Empty, Stat } from '@/components/ui/card';
import { Table, Td, Th } from '@/components/ui/table';
import { api } from '@/lib/api';
import { brandStyle } from '@/lib/brand';
import { clientOf } from '@/lib/client';
import { count, day, limitShort, money, relative } from '@/lib/format';
import type { ClientSummary, InboxItem, PolicyReport, Program } from '@/lib/types';
import { CHAT_STATE } from '@/lib/words';

export const metadata: Metadata = { title: 'Client console', robots: { index: false } };

const MONTH = /^\d{4}-\d{2}$/;
const monthName = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-CA', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
const shift = (month: string, by: number) => {
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 7);
};

function LinkOff() {
  return (
    <main className="mx-auto max-w-xl px-5 py-24">
      <h1 className="text-[1.9rem] text-ink">This link does not open a console</h1>
      <p className="mt-3 text-ink-soft">
        It may have been turned off, or copied only in part. Ask the people who run your program for
        a new one; each link opens one program’s figures and nothing else.
      </p>
    </main>
  );
}

// What a client program sees of itself, by a link the operator hands out: how its portal is doing, the policies it
// issued, the month's policies and what renters wrote. Never another program's.
export default async function ClientConsole({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const access = await clientOf((await params).code);
  if (!access) return <LinkOff />;
  const as = { client: access.programId };
  const thisMonth = new Date().toISOString().slice(0, 7);
  const asked = (await searchParams).month;
  const month = asked && MONTH.test(asked) && asked <= thisMonth ? asked : thisMonth;

  const [{ programs }, { clients }, policyReport, { conversations }] = await Promise.all([
    api<{ programs: Program[] }>('operator', '/v1/programs'),
    api<{ clients: ClientSummary[] }>(as, '/v1/hub/clients'),
    api<PolicyReport>(as, `/v1/reports/policies?month=${month}`),
    api<{ conversations: InboxItem[] }>(as, '/v1/inbox'),
  ]);
  const program = programs.find((p) => p.id === access.programId) as Program;
  const figures = clients[0];
  const now = new Date();

  return (
    <div className="min-h-dvh" style={brandStyle(program.theme)}>
      <header className="border-t-4 border-b border-t-brand border-b-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-5">
          <div className="flex items-center gap-3.5">
            {program.theme?.logo ? (
              <Image
                src={program.theme.logo}
                alt=""
                width={44}
                height={44}
                className="size-11 rounded-control object-contain"
              />
            ) : null}
            <div>
              <h1 className="font-serif text-[1.5rem] leading-tight font-semibold text-ink">
                {program.name}
              </h1>
              <p className="text-sm text-ink-faint">
                Client console · opened with the link “{access.label}”
              </p>
            </div>
          </div>
          <Link
            href={`/p/${program.code}`}
            className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
          >
            Your portal <ArrowUpRight className="size-3.5" aria-hidden />
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-5 py-8">
        {figures ? (
          <Card aria-label="Last 30 days">
            <CardHeader
              title="Last 30 days"
              note="Visitors to your portal, and what came of them."
            />
            <CardBody className="grid gap-6 sm:grid-cols-[repeat(5,minmax(0,1fr))_auto] sm:items-end">
              <Stat label="Visitors" value={count(figures.visits)} />
              <Stat
                label="Quotes"
                value={count(figures.quotes)}
                note={figures.referred ? `${count(figures.referred)} to an underwriter` : undefined}
              />
              <Stat label="Policies" value={count(figures.policies)} />
              <Stat label="Premium" value={money(figures.premiumCents)} />
              <Stat
                label="With an underwriter now"
                value={count(figures.openReferrals)}
                note={
                  figures.oldestOpenAt ? `oldest ${relative(figures.oldestOpenAt, now)}` : undefined
                }
              />
              <Sparkline daily={figures.daily} />
            </CardBody>
          </Card>
        ) : null}

        <Card aria-label="Policies">
          <CardHeader
            title={`Policies issued in ${monthName(month)}`}
            note="The policies issued in the month."
            aside={
              <>
                <ButtonLink
                  href={`/c/${program.code}?month=${shift(month, -1)}`}
                  variant="quiet"
                  size="sm"
                >
                  Earlier
                </ButtonLink>
                {month < thisMonth ? (
                  <ButtonLink
                    href={`/c/${program.code}?month=${shift(month, 1)}`}
                    variant="quiet"
                    size="sm"
                  >
                    Later
                  </ButtonLink>
                ) : null}
                <a
                  href={`/c/${program.code}/policies?month=${month}`}
                  className="inline-flex h-8 items-center gap-2 rounded-control border border-line-strong bg-surface px-3 text-sm font-medium text-ink hover:bg-sunken"
                >
                  <Download className="size-4" aria-hidden /> CSV
                </a>
              </>
            }
          />
          {policyReport.lines.length === 0 ? (
            <Empty title="No policies this month">
              Policies show here as renters buy them on your portal.
            </Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Policy</Th>
                  <Th>Event</Th>
                  <Th>Venue</Th>
                  <Th numeric>People</Th>
                  <Th numeric>Limit</Th>
                  <Th numeric>Premium</Th>
                </tr>
              </thead>
              <tbody>
                {policyReport.lines.map((line) => (
                  <tr key={line.policyNumber}>
                    <Td>
                      <span className="font-mono text-[0.85rem]">{line.policyNumber}</span>
                      <span className="block text-[0.78rem] text-ink-faint">
                        issued {day(line.issuedOn)}
                      </span>
                    </Td>
                    <Td>
                      {line.activity}
                      <span className="block text-[0.78rem] text-ink-faint">
                        {day(line.eventDate)}
                      </span>
                    </Td>
                    <Td>{line.venue || '—'}</Td>
                    <Td numeric>{count(line.participants)}</Td>
                    <Td numeric>{limitShort(line.limitCents)}</Td>
                    <Td numeric>{money(line.totalCents)}</Td>
                  </tr>
                ))}
                <tr>
                  <Td className="font-medium text-ink">Total</Td>
                  <Td>{count(policyReport.summary.total.policies)} policies</Td>
                  <Td />
                  <Td />
                  <Td />
                  <Td numeric className="font-semibold text-ink">
                    {money(policyReport.summary.total.totalCents)}
                  </Td>
                </tr>
              </tbody>
            </Table>
          )}
        </Card>

        <Card aria-label="Conversations">
          <CardHeader
            title="What renters asked"
            note="From the chat on your portal and Telegram. The assistant answered what it could; people took the rest."
          />
          {conversations.length === 0 ? (
            <Empty title="No conversations yet" />
          ) : (
            <ul className="divide-y divide-line">
              {conversations.slice(0, 20).map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-4 px-5 py-3">
                  <p className="min-w-0 text-[0.92rem] text-ink-soft">
                    <span className="line-clamp-2">{c.last?.text ?? '—'}</span>
                    <span className="mt-0.5 block text-[0.78rem] text-ink-faint">
                      {c.channel === 'telegram' ? 'Telegram' : 'Portal chat'} ·{' '}
                      {relative(c.updatedAt, now)}
                    </span>
                  </p>
                  <Badge tone={CHAT_STATE[c.state].tone}>{CHAT_STATE[c.state].word}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <p className="text-[0.8rem] text-ink-faint">
          This console shows {program.name} only. It opened with a link from the people who run the
          program, who can turn it off at any time. Every name and figure in this demo is invented.
        </p>
      </main>
    </div>
  );
}
