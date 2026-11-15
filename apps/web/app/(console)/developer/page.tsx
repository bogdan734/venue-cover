import type { Metadata } from 'next';
import Link from 'next/link';
import { EventFeed } from '@/components/dev/event-feed';
import { GraphqlBox } from '@/components/dev/graphql-box';
import { ActionButton, EndpointForm } from '@/components/dev/webhook-forms';
import { PageHeader } from '@/components/page-header';
import { Badge, type Tone } from '@/components/ui/badge';
import { Card, CardBody, CardHeader, Empty } from '@/components/ui/card';
import { Code, Table, Td, Th } from '@/components/ui/table';
import { api } from '@/lib/api';
import { cx } from '@/lib/cx';
import { relative } from '@/lib/format';
import type { Program } from '@/lib/types';
import { DELIVERABLE_EVENT_TYPES as DELIVERABLE } from '../../../../api/src/domain/types';
import {
  registerEndpoint,
  removeEndpoint,
  replayDelivery,
  runGraphql,
  sendTestEvent,
} from './actions';

export const metadata: Metadata = { title: 'Developer' };

interface Endpoint {
  id: string;
  url: string;
  events: string[];
  active: boolean;
}
interface LoggedRequest {
  at: string;
  key: string;
  method: string;
  route: string;
  status: number;
  ms: number;
}

const statusTone = (status: number): Tone =>
  status >= 500 ? 'danger' : status >= 400 ? 'warn' : 'ok';

interface Delivery {
  id: string;
  endpointId: string;
  eventType: string | null;
  attempt: number;
  state: 'pending' | 'delivered' | 'dead';
  lastStatus: number | null;
  lastError: string | null;
  createdAt: string;
}
interface Operation {
  summary?: string;
  'x-required-scope'?: string;
}

const STATE_TONE: Record<string, Tone> = { pending: 'warn', delivered: 'ok', dead: 'danger' };
const RECEIVERS = [
  'https://hooks.example.test/ok',
  'https://hooks.example.test/flaky',
  'https://hooks.example.test/gone',
];

export default async function Developer({
  searchParams,
}: {
  searchParams: Promise<{ program?: string }>;
}) {
  const query = await searchParams;
  const { programs } = await api<{ programs: Program[] }>('operator', '/v1/programs');
  const program = programs.find((p) => p.id === query.program) ?? programs[0];
  if (!program) return <Empty title="There are no programs yet" />;
  const as = { program: program.id };
  const [{ endpoints }, { deliveries }, openapi, { requests }] = await Promise.all([
    api<{ endpoints: Endpoint[] }>(as, '/v1/webhook-endpoints'),
    api<{ deliveries: Delivery[] }>(as, '/v1/webhook-deliveries'),
    api<{ paths: Record<string, Record<string, Operation>> }>('operator', '/v1/openapi.json'),
    api<{ requests: LoggedRequest[] }>(as, '/v1/request-log?limit=25'),
  ]);
  const names = Object.fromEntries(programs.map((p) => [p.id, p.code]));
  const urlOf = new Map(endpoints.map((e) => [e.id, e.url]));
  const operations = Object.entries(openapi.paths).flatMap(([path, methods]) =>
    Object.entries(methods).map(([method, operation]) => ({
      method: method.toUpperCase(),
      path,
      operation,
    })),
  );
  const now = new Date();

  const examples = [
    {
      label: 'Search the catalogue',
      query: '{\n  activities(q: "fireworks") {\n    title\n    riskClass\n    score\n  }\n}',
    },
    {
      label: 'Read a description',
      query:
        'mutation {\n  classifyEvent(text: "Yoga class for 20 people, 2 hours, no alcohol") {\n    riskClass\n    confidence\n    decision { outcome reasons }\n    primary { title score }\n  }\n}',
    },
    {
      label: 'This program',
      query: `{\n  program(id: "${program.id}") {\n    code\n    name\n    rules\n  }\n}`,
    },
  ];

  return (
    <>
      <PageHeader title="Events, webhooks and APIs">
        What a partner integrates with: the same events by webhook and by live feed, a GraphQL
        endpoint over the same services as REST, and the API’s own description.
      </PageHeader>

      <nav aria-label="Program" className="mb-6 flex flex-wrap gap-2">
        {programs.map((p) => (
          <Link
            key={p.id}
            href={`/developer?program=${p.id}`}
            aria-current={p.id === program.id ? 'page' : undefined}
            className={cx(
              'rounded-full border px-3.5 py-1 text-sm transition-colors duration-150',
              p.id === program.id
                ? 'border-brand bg-brand-soft font-semibold text-brand-strong'
                : 'border-line-strong bg-surface text-ink-soft hover:border-brand',
            )}
          >
            <span className="font-mono text-[0.78rem]">{p.code}</span> {p.name}
          </Link>
        ))}
      </nav>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card aria-label="Live events">
          <CardHeader title="Live events" note="Every program’s events, as they are recorded." />
          <EventFeed programs={names} />
        </Card>

        <div className="space-y-6">
          <Card aria-label="Webhook endpoints">
            <CardHeader
              title={`Webhook endpoints · ${program.code}`}
              note="Signed with HMAC-SHA256, retried with backoff, never sent to a private address."
            />
            <CardBody>
              <EndpointForm
                action={registerEndpoint.bind(null, program.id)}
                eventTypes={DELIVERABLE}
                suggestions={RECEIVERS}
              />
            </CardBody>
            {endpoints.length > 0 ? (
              <ul className="divide-y divide-line border-t border-line">
                {endpoints.map((endpoint) => (
                  <li
                    key={endpoint.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3"
                  >
                    <span className="min-w-0 flex-1">
                      <Code className="break-all">{endpoint.url}</Code>
                      <span className="block text-[0.8rem] text-ink-faint">
                        {endpoint.events.join(', ')}
                      </span>
                    </span>
                    {endpoint.active ? (
                      <ActionButton
                        label={`Send a test event to ${endpoint.url}`}
                        run={sendTestEvent.bind(null, program.id, endpoint.id)}
                      >
                        Send test event
                      </ActionButton>
                    ) : null}
                    {endpoint.active ? (
                      <ActionButton
                        variant="danger"
                        label={`Remove ${endpoint.url}`}
                        run={removeEndpoint.bind(null, program.id, endpoint.id)}
                      >
                        Remove
                      </ActionButton>
                    ) : (
                      <Badge>removed</Badge>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
        </div>
      </div>

      <Card aria-label="Deliveries" className="mt-6">
        <CardHeader
          title="Deliveries"
          note="One row per event sent to an endpoint. A refused delivery can be sent again with the same event id."
        />
        {deliveries.length === 0 ? (
          <Empty title="No deliveries yet">
            Register an endpoint for policy.issued, then buy a policy on this program’s portal.
          </Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Event</Th>
                <Th>Endpoint</Th>
                <Th>State</Th>
                <Th numeric>Attempts</Th>
                <Th>Answer</Th>
                <Th>When</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((delivery) => (
                <tr key={delivery.id}>
                  <Td>
                    <Code>{delivery.eventType ?? '—'}</Code>
                  </Td>
                  <Td>
                    <Code className="break-all">
                      {(urlOf.get(delivery.endpointId) ?? '').replace(
                        'https://hooks.example.test',
                        '…',
                      )}
                    </Code>
                  </Td>
                  <Td>
                    <Badge tone={STATE_TONE[delivery.state]}>{delivery.state}</Badge>
                  </Td>
                  <Td numeric>{delivery.attempt}</Td>
                  <Td className="text-ink-soft">
                    {delivery.lastError ??
                      (delivery.lastStatus ? `HTTP ${delivery.lastStatus}` : '—')}
                  </Td>
                  <Td className="whitespace-nowrap text-ink-soft">
                    {relative(delivery.createdAt, now)}
                  </Td>
                  <Td>
                    {delivery.state === 'pending' ? null : (
                      <ActionButton
                        label={`Send delivery ${delivery.id} again`}
                        run={replayDelivery.bind(null, program.id, delivery.id)}
                      >
                        Send again
                      </ActionButton>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card aria-label="Recent requests" className="mt-6">
        <CardHeader
          title={`Recent requests · ${program.code}`}
          note="Every call made with this program’s keys, newest first. Routes, not addresses: ids and queries can hold personal details."
        />
        {requests.length === 0 ? (
          <Empty title="No requests yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Key</Th>
                <Th>Request</Th>
                <Th>Status</Th>
                <Th numeric>Time</Th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={`${r.at}-${r.route}-${r.method}`}>
                  <Td className="whitespace-nowrap text-ink-faint">{relative(r.at, now)}</Td>
                  <Td>{r.key}</Td>
                  <Td>
                    <Code>
                      {r.method} {r.route}
                    </Code>
                  </Td>
                  <Td>
                    <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                  </Td>
                  <Td numeric>{r.ms} ms</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card aria-label="GraphQL">
          <CardHeader
            title="GraphQL"
            note={`Runs as ${program.code}’s portal key. Mutations take an idempotency key, supplied here.`}
          />
          <GraphqlBox run={runGraphql.bind(null, program.id)} examples={examples} />
        </Card>
        <Card aria-label="API reference">
          <CardHeader
            title="API reference"
            note={`${operations.length} operations, read live from the API’s OpenAPI description.`}
            aside={
              <a
                href="/api/openapi"
                className="text-sm font-medium text-brand hover:text-brand-strong"
              >
                openapi.json
              </a>
            }
          />
          <div className="max-h-[28rem] overflow-y-auto">
            <Table>
              <tbody>
                {operations.map(({ method, path, operation }) => (
                  <tr key={`${method} ${path}`}>
                    <Td className="w-16 font-mono text-[0.75rem] font-semibold text-brand">
                      {method}
                    </Td>
                    <Td>
                      <Code className="break-all">{path}</Code>
                      <span className="block text-[0.82rem] text-ink-faint">
                        {operation.summary}
                      </span>
                    </Td>
                    <Td className="text-right font-mono text-[0.72rem] text-ink-faint">
                      {operation['x-required-scope'] ?? ''}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card>
      </div>
    </>
  );
}
