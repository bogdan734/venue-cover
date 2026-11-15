import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { type CountKind, CountUp } from '@/components/count-up';
import { ButtonLink } from '@/components/ui/button';
import { Label } from '@/components/ui/card';
import { api } from '@/lib/api';
import { loadEvals } from '@/lib/evals';
import { money } from '@/lib/format';
import type { PolicyReport, Program } from '@/lib/types';

// The business in the order it happens. Each step is one area of the back office, or the portal itself.
const STEPS: { title: string; text: string; cta: string; href: (portal: string) => string }[] = [
  {
    title: 'Set up',
    text: 'A new client is a template plus its own rules. Paste the client’s letter, see the draft and what it would change on recent quotes, publish from a date.',
    cta: 'Program studio',
    href: () => '/programs',
  },
  {
    title: 'Describe',
    text: 'A renter types what the event is. The portal shows how it was read: the facts, the activity it matched, and what the model saw in place of personal details.',
    cta: 'A client portal',
    href: (portal) => `/p/${portal}`,
  },
  {
    title: 'Decide',
    text: 'The program’s rules price it on the spot, or name the reasons a person has to look.',
    cta: 'A client portal',
    href: (portal) => `/p/${portal}`,
  },
  {
    title: 'Refer',
    text: 'An underwriter gets the reasons, a worksheet with a basis for every line and the nearest past decisions.',
    cta: 'Underwriting desk',
    href: () => '/underwriting',
  },
  {
    title: 'Issue',
    text: 'Payment makes a policy and a certificate for each party. Partners hear about it by signed webhook.',
    cta: 'Developer console',
    href: () => '/developer',
  },
  {
    title: 'Measure',
    text: 'How often the automation is right, with intervals; how many personal details reached the model; what people decided against it.',
    cta: 'Quality',
    href: () => '/quality',
  },
];

export default async function Home() {
  const month = new Date().toISOString().slice(0, 7);
  const [{ programs }, { referrals }, policyReport] = await Promise.all([
    api<{ programs: Program[] }>('operator', '/v1/programs'),
    api<{ referrals: { id: string }[] }>('operator', '/v1/referrals'),
    api<PolicyReport>('operator', `/v1/reports/policies?month=${month}`),
  ]);
  const first = programs[0]?.code ?? '';
  const best = loadEvals().find((e) => e.label.endsWith('+transformers'));
  const kpis: {
    label: string;
    href: string;
    value: number;
    kind: CountKind;
    note: string;
  }[] = [
    {
      label: 'Policies this month',
      href: '/programs',
      value: policyReport.summary.total.policies,
      kind: 'count',
      note: money(policyReport.summary.total.totalCents),
    },
    {
      label: 'Waiting for a person',
      href: '/underwriting',
      value: referrals.length,
      kind: 'count',
      note: 'referrals in the queue',
    },
    ...(best
      ? [
          {
            label: 'Routed right',
            href: '/quality',
            value: (best.summary.outcomeAccuracy.value ?? 0) * 100,
            kind: 'percent' as const,
            note: `${best.summary.unsafeAutomation} unsafe automation`,
          },
        ]
      : []),
  ];

  return (
    <>
      <section className="max-w-3xl">
        <h1 className="text-[2.4rem] leading-[1.1] text-ink sm:text-[2.9rem]">
          A sentence in, a policy out, and a person wherever judgement is needed.
        </h1>
        <p className="mt-4 max-w-2xl text-[1.05rem] text-ink-soft">
          Someone renting a hall describes their event in their own words. The platform reads it,
          prices it from a rate card, and either issues the policy or hands it to an underwriter
          with the reasons. Everything else a managing general agent needs sits around that.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <ButtonLink href={`/p/${first}`}>
            Start as a renter <ArrowRight className="size-4" aria-hidden />
          </ButtonLink>
          <ButtonLink href="/underwriting" variant="secondary">
            Open the underwriting desk
          </ButtonLink>
        </div>
        <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-faint">
          Client portals
          {programs.map((program) => (
            <Link
              key={program.id}
              href={`/p/${program.code}`}
              className="font-medium text-brand hover:text-brand-strong hover:underline"
            >
              {program.name}
            </Link>
          ))}
        </p>
      </section>

      <section aria-label="Right now" className="mt-10">
        <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line lg:grid-cols-4">
          {kpis.map((kpi) => (
            <li key={kpi.label} className="bg-surface">
              <Link
                href={kpi.href}
                className="group block h-full px-5 py-4 transition-colors duration-150 hover:bg-brand-soft/40"
              >
                <Label>{kpi.label}</Label>
                <p className="mt-0.5 text-[2rem] leading-tight font-semibold tracking-[-0.015em] text-ink">
                  <CountUp value={kpi.value} kind={kpi.kind} />
                </p>
                <p className="mt-0.5 text-sm text-ink-faint">{kpi.note}</p>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="follow" className="mt-12">
        <h2 id="follow" className="text-[1.45rem] text-ink">
          Follow one event through
        </h2>
        <ol className="mt-4 overflow-hidden rounded-card border border-line bg-surface">
          {STEPS.map((step, index) => (
            <li key={step.title} className="border-b border-line last:border-b-0">
              <Link
                href={step.href(first)}
                className="group grid items-baseline gap-x-6 gap-y-1 px-5 py-4 transition-colors duration-150 hover:bg-brand-soft/40 sm:grid-cols-[1.5rem_7.5rem_minmax(0,1fr)_auto]"
              >
                <span className="text-sm font-medium text-ink-faint">{index + 1}</span>
                <h3 className="font-serif text-[1.15rem] font-semibold text-ink">{step.title}</h3>
                <p className="max-w-[62ch] text-[0.95rem] text-ink-soft">{step.text}</p>
                <span className="inline-flex items-center gap-1 text-sm font-medium whitespace-nowrap text-brand">
                  {step.cta}
                  <ArrowRight
                    className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="honest" className="mt-12 max-w-3xl">
        <h2 id="honest" className="text-[1.45rem] text-ink">
          What is real here and what is not
        </h2>
        <dl className="mt-4 grid gap-x-8 gap-y-4 text-[0.92rem] sm:grid-cols-2">
          <div>
            <dt className="font-semibold text-ink">Real</dt>
            <dd className="mt-1 text-ink-soft">
              The API, its database, the rating, the rules, the referral queue, the documents, the
              events and webhooks, the reports. Every page here is a client of the same public API.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-ink">Invented or simulated</dt>
            <dd className="mt-1 text-ink-soft">
              Every program, rate, broker and name. Card payments and e-mail go to a recording fake.
              The examples are answered from a recording of a local model; other text is read by
              plain rules unless a model is configured.
            </dd>
          </div>
        </dl>
      </section>
    </>
  );
}
