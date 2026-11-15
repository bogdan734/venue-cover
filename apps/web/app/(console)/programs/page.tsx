import { ArrowUpRight, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Sparkline } from '@/components/hub/sparkline';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, Td, Th } from '@/components/ui/table';
import { api } from '@/lib/api';
import { count, money, relative } from '@/lib/format';
import type { ClientSummary } from '@/lib/types';
import { STATUS } from '@/lib/words';

export const metadata: Metadata = { title: 'Programs' };

// The hub: every client program, where it is in its life and how its last month went, on one screen.
export default async function Programs() {
  const { clients } = await api<{ since: string; clients: ClientSummary[] }>(
    'operator',
    '/v1/hub/clients',
  );
  const now = new Date();
  const total = (pick: (c: ClientSummary) => number) => clients.reduce((a, c) => a + pick(c), 0);

  return (
    <>
      <PageHeader
        title="Client programs"
        actions={
          <ButtonLink href="/programs/new">
            <Plus className="size-4" aria-hidden /> New program
          </ButtonLink>
        }
      >
        A new client is a row here, not a new site: its portal exists as soon as the program does,
        is tried by staff while it is a draft, and opens when it goes live.{' '}
        {total((c) => c.visits + c.quotes) === 0
          ? 'Nothing has happened on the portals in this demo yet: get a price on one, without signing in as staff, and it shows here.'
          : `In the last 30 days the ${count(clients.length)} programs had ${count(total((c) => c.visits))} portal visitors and issued ${count(total((c) => c.policies))} policies for ${money(total((c) => c.premiumCents))}.`}
      </PageHeader>
      <Card aria-label="Clients">
        <Table>
          <thead>
            <tr>
              <Th>Program</Th>
              <Th>Status</Th>
              <Th>Last 30 days</Th>
              <Th numeric>Visitors</Th>
              <Th numeric>Quotes</Th>
              <Th numeric>Policies</Th>
              <Th numeric>Premium</Th>
              <Th>With a person</Th>
              <Th>
                <span className="sr-only">Portal</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {clients.map(({ program, ...month }) => (
              <tr key={program.id} className="transition-colors duration-150 hover:bg-sunken/40">
                <Td>
                  <Link
                    href={`/programs/${program.id}`}
                    className="font-medium text-brand hover:text-brand-strong hover:underline"
                  >
                    {program.name}
                  </Link>
                  <span className="block text-[0.8rem] text-ink-faint">
                    <span className="font-mono">{program.code}</span> · {program.brokerName}
                  </span>
                </Td>
                <Td>
                  <Badge tone={STATUS[program.status].tone}>{STATUS[program.status].word}</Badge>
                </Td>
                <Td className="py-3">
                  <Sparkline daily={month.daily} />
                </Td>
                <Td numeric>{count(month.visits)}</Td>
                <Td numeric>
                  {count(month.quotes)}
                  {month.referred > 0 ? (
                    <span className="block text-[0.78rem] text-ink-faint">
                      {count(month.referred)} referred
                    </span>
                  ) : null}
                </Td>
                <Td numeric>
                  {count(month.policies)}
                  {month.claims > 0 ? (
                    <span className="block text-[0.78rem] text-ink-faint">
                      {count(month.claims)} {month.claims === 1 ? 'claim' : 'claims'}
                    </span>
                  ) : null}
                </Td>
                <Td numeric>{money(month.premiumCents)}</Td>
                <Td>
                  {month.openReferrals > 0 && month.oldestOpenAt ? (
                    <Link href="/underwriting" className="group block">
                      <Badge tone="warn">{count(month.openReferrals)} waiting</Badge>
                      <span className="mt-0.5 block text-[0.78rem] text-ink-faint group-hover:underline">
                        oldest {relative(month.oldestOpenAt, now)}
                      </span>
                    </Link>
                  ) : (
                    <span className="text-ink-faint">None</span>
                  )}
                </Td>
                <Td>
                  <Link
                    href={`/p/${program.code}`}
                    className="inline-flex items-center gap-1 text-sm whitespace-nowrap text-brand hover:underline"
                  >
                    Portal <ArrowUpRight className="size-3.5" aria-hidden />
                  </Link>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
