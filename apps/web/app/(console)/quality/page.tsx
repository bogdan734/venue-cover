import type { Metadata } from 'next';
import Link from 'next/link';
import { CountUp } from '@/components/count-up';
import { PageHeader } from '@/components/page-header';
import { PrivacyCard } from '@/components/quality/privacy-card';
import { SetupBars } from '@/components/quality/setup-bars';
import { ThresholdChart } from '@/components/quality/threshold-chart';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader, Empty, Stat } from '@/components/ui/card';
import { Table, Td, Th } from '@/components/ui/table';
import { api } from '@/lib/api';
import { loadEvals, loadPrivacy, NAMES } from '@/lib/evals';
import { count, percent } from '@/lib/format';
import type { Metric, PrivacyLive, ShadowReport } from '@/lib/types';
import { REASONS } from '@/lib/words';

export const metadata: Metadata = { title: 'Quality' };

const ORDER = ['fake', 'replay-qwen2.5-14b', 'replay-qwen2.5-14b+transformers'];
const interval = (m: Metric) =>
  m.value === null ? '' : `${percent(m.low, 0)}–${percent(m.high, 0)}`;

function Cell({ m, bar }: { m: Metric; bar?: boolean }) {
  return (
    <Td numeric>
      <span className="inline-flex items-center gap-2.5">
        {bar ? (
          <span className="block h-1.5 w-20 overflow-hidden rounded-full bg-sunken" aria-hidden>
            <span
              className="grow-x block h-full rounded-full bg-brand"
              style={{ width: `${(m.value ?? 0) * 100}%` }}
            />
          </span>
        ) : null}
        {percent(m.value)}
      </span>
      <span className="block text-[0.78rem] text-ink-faint">{interval(m)}</span>
    </Td>
  );
}

const pc = (m: Metric) => <CountUp value={(m.value ?? 0) * 100} kind="percent" />;

const VERDICT: Record<string, { word: string; tone: 'ok' | 'info' | 'warn' | 'danger' }> = {
  automation_agrees: { word: 'Automation agrees', tone: 'ok' },
  human_needed: { word: 'A person was needed', tone: 'info' },
  rubber_stamp: { word: 'A person was not needed', tone: 'warn' },
  automation_unsafe: { word: 'Automation would be unsafe', tone: 'danger' },
};

export default async function Quality({
  searchParams,
}: {
  searchParams: Promise<{ since?: string }>;
}) {
  const evals = loadEvals().sort((a, b) => ORDER.indexOf(a.label) - ORDER.indexOf(b.label));
  const best = evals.at(-1);
  const since = /^\d{4}-\d{2}-\d{2}$/.test((await searchParams).since ?? '')
    ? (await searchParams).since
    : undefined;
  const [shadow, privacy] = await Promise.all([
    api<ShadowReport>('operator', `/v1/reports/shadow${since ? `?since=${since}` : ''}`),
    api<PrivacyLive>('operator', '/v1/privacy'),
  ]);
  const kinds = best
    ? Object.entries(best.summary.byTag).sort(([a], [b]) => a.localeCompare(b))
    : [];

  return (
    <>
      <PageHeader title="How often the automation is right">
        {best ? count(best.summary.n) : 'Invented'} descriptions with known answers, judged against
        one program’s rules. Intervals are 95% Wilson intervals. The number that must stay at zero
        is unsafe automation: an event that needed a person but was priced without one.
      </PageHeader>

      {best ? (
        <Card aria-label="Headline" className="mb-6">
          <CardHeader
            title={NAMES[best.label]?.title ?? best.label}
            note={NAMES[best.label]?.note}
            aside={<Badge tone="ok">{best.summary.unsafeAutomation} unsafe</Badge>}
          />
          <CardBody className="grid grid-cols-2 gap-6 sm:grid-cols-5">
            <Stat
              label="Routed right"
              value={pc(best.summary.outcomeAccuracy)}
              note={interval(best.summary.outcomeAccuracy)}
            />
            <Stat
              label="Priced unseen"
              value={pc(best.summary.automaticRate)}
              note={interval(best.summary.automaticRate)}
            />
            <Stat
              label="Activity found"
              value={pc(best.summary.top1)}
              note={interval(best.summary.top1)}
            />
            <Stat
              label="Must-refer caught"
              value={pc(best.summary.referralRecall)}
              note={interval(best.summary.referralRecall)}
            />
            <Stat
              label="Unsafe automation"
              value={count(best.summary.unsafeAutomation)}
              note="should be 0"
            />
          </CardBody>
        </Card>
      ) : null}

      <PrivacyCard result={loadPrivacy()} live={privacy} />

      <Card aria-label="Evaluations" className="mb-6">
        <CardHeader
          title="Three setups, one set of descriptions"
          note="Each step up is a change of what reads the text or matches it."
        />
        <CardBody className="border-b border-line">
          <SetupBars
            evals={evals}
            names={Object.fromEntries(
              evals.map((e) => [e.label, NAMES[e.label]?.title ?? e.label]),
            )}
          />
        </CardBody>
        <Table>
          <thead>
            <tr>
              <Th>Setup</Th>
              <Th numeric>Activity found</Th>
              <Th numeric>Routed right</Th>
              <Th numeric>Priced unseen</Th>
              <Th numeric>Needed referrals</Th>
              <Th numeric>Unsafe</Th>
            </tr>
          </thead>
          <tbody>
            {evals.map((e) => (
              <tr key={e.label}>
                <Td className="min-w-80">
                  <span className="font-medium text-ink">{NAMES[e.label]?.title ?? e.label}</span>
                  <span className="block max-w-md text-[0.82rem] text-ink-faint">
                    {NAMES[e.label]?.note}
                  </span>
                </Td>
                <Cell m={e.summary.top1} />
                <Cell m={e.summary.outcomeAccuracy} />
                <Cell m={e.summary.automaticRate} />
                <Cell m={e.summary.referralPrecision} />
                <Td
                  numeric
                  className={e.summary.unsafeAutomation === 0 ? 'text-ok' : 'text-danger'}
                >
                  {e.summary.unsafeAutomation}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="border-t border-line px-5 py-3 text-[0.82rem] text-ink-faint">
          The descriptions and their answers were written for this project, and the embedder’s scale
          was chosen on the same set, so these figures are optimistic for text from real customers.
        </p>
      </Card>

      <div className="mb-6 grid items-start gap-6 xl:grid-cols-2">
        {best ? (
          <Card aria-label="Threshold sweep" className="xl:sticky xl:top-6">
            <CardHeader title="Where the threshold can sit" note="With the multilingual setup." />
            <CardBody>
              <ThresholdChart sweep={best.sweep} />
            </CardBody>
          </Card>
        ) : null}
        <Card aria-label="By kind of case">
          <CardHeader
            title="By kind of case"
            note="Typos, French, paraphrase, injection attempts, missing facts, unknowns."
          />
          <Table>
            <thead>
              <tr>
                <Th>Kind</Th>
                <Th numeric>Cases</Th>
                <Th numeric>Activity found</Th>
                <Th numeric>Routed right</Th>
              </tr>
            </thead>
            <tbody>
              {kinds.map(([kind, group]) => (
                <tr key={kind}>
                  <Td>{kind}</Td>
                  <Td numeric>{group.n}</Td>
                  <Cell m={group.top1} />
                  <Cell m={group.outcomeAccuracy} bar />
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>

      <Card aria-label="Shadow replay">
        <CardHeader
          title="Shadow replay: would the automation have made the calls people made?"
          note={`Referrals decided since ${shadow.since.slice(0, 10)}, read and judged again by today’s model and rules. Nothing is stored.`}
          aside={
            <form method="get" className="flex items-center gap-2">
              <label htmlFor="since" className="sr-only">
                Since
              </label>
              <input
                id="since"
                name="since"
                type="date"
                defaultValue={shadow.since.slice(0, 10)}
                className="h-8 rounded-control border border-line-strong bg-surface px-2 text-sm"
              />
              <button
                type="submit"
                className="h-8 rounded-control border border-line-strong bg-surface px-3 text-sm hover:bg-sunken"
              >
                Replay
              </button>
            </form>
          }
        />
        {shadow.replayed === 0 ? (
          <Empty title="No decided referrals to replay">
            Decide a referral on the{' '}
            <Link href="/underwriting" className="text-brand hover:underline">
              underwriting desk
            </Link>{' '}
            made from a description, and come back: the replay compares what you decided with what
            the automation would do.
          </Empty>
        ) : (
          <>
            <CardBody className="grid grid-cols-2 gap-6 border-b border-line sm:grid-cols-4">
              <Stat
                label="Replayed"
                value={count(shadow.replayed)}
                note={`${shadow.skipped} had no description`}
              />
              <Stat
                label="Agreement"
                value={percent(shadow.agreement.value)}
                note={interval(shadow.agreement)}
              />
              <Stat label="Would be priced unseen" value={percent(shadow.automaticRate.value)} />
              <Stat
                label="Unsafe"
                value={count(shadow.counts.automation_unsafe)}
                note="declined or changed by a person"
              />
            </CardBody>
            {shadow.disagreements.length > 0 ? (
              <Table>
                <thead>
                  <tr>
                    <Th>Description</Th>
                    <Th>A person did</Th>
                    <Th>Automation says</Th>
                    <Th>Verdict</Th>
                  </tr>
                </thead>
                <tbody>
                  {shadow.disagreements.map((row) => (
                    <tr key={row.referralId}>
                      <Td className="max-w-sm">{row.text}</Td>
                      <Td>
                        {row.human.action.replaceAll('_', ' ')}
                        {row.human.edited ? ', edited' : ''}
                      </Td>
                      <Td>
                        {row.system.outcome === 'auto'
                          ? 'Price unseen'
                          : row.system.reasons.map((r) => REASONS[r].title).join(', ')}
                      </Td>
                      <Td>
                        <Badge tone={VERDICT[row.verdict]?.tone}>
                          {VERDICT[row.verdict]?.word}
                        </Badge>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : null}
          </>
        )}
      </Card>
    </>
  );
}
