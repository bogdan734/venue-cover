import { randomUUID } from 'node:crypto';
import { CircleCheck, FileText } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { ClaimForm } from '@/components/portal/claim-form';
import { Steps } from '@/components/portal/steps';
import { Card, CardBody, CardHeader, Label } from '@/components/ui/card';
import { ApiError, api } from '@/lib/api';
import { count, day, limit, money, stamp } from '@/lib/format';
import { portalOf } from '@/lib/portal';
import type { Policy } from '@/lib/types';
import { ALCOHOL } from '@/lib/words';
import { reportLoss } from '../../actions';

export const metadata: Metadata = { title: 'Your policy' };

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

export default async function PolicyPage({
  params,
}: {
  params: Promise<{ code: string; id: string }>;
}) {
  const { code, id } = await params;
  const { program, as } = await portalOf(code);
  let policy: Policy;
  try {
    policy = await api<Policy>(as, `/v1/policies/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const s = policy.snapshot;
  const certificates = [
    { holder: 'insured', who: s.holder.name, role: 'You, the insured' },
    ...(s.recipients.venue
      ? [{ holder: 'venue', who: s.recipients.venue.name, role: 'The venue' }]
      : []),
    ...(s.recipients.broker
      ? [{ holder: 'broker', who: s.recipients.broker.name, role: 'The venue’s broker' }]
      : []),
  ];

  return (
    <>
      <Steps current="Policy" />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <section aria-labelledby="issued" className="space-y-6">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold text-ok">
              <CircleCheck className="size-4" aria-hidden /> Paid and issued
            </p>
            <h1 id="issued" className="mt-1.5 text-[2.1rem] text-ink">
              You are covered. Policy{' '}
              <span className="whitespace-nowrap">{policy.policyNumber}</span>
            </h1>
            <p className="mt-2 text-ink-soft">
              Issued {stamp(policy.issuedAt)} for {money(policy.totalCents)}.
            </p>
          </div>

          <Card>
            <CardHeader title="What is covered" />
            <CardBody>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-[0.95rem]">
                <Detail label="Insured">{s.holder.name}</Detail>
                <Detail label="Activity">{s.activityTitle}</Detail>
                <Detail label="From">{stamp(policy.startsAt).replace(' UTC', '')}</Detail>
                <Detail label="Until">{stamp(policy.endsAt).replace(' UTC', '')}</Detail>
                <Detail label="Venue">{s.venue?.name ?? 'Not named'}</Detail>
                <Detail label="Liability limit">{limit(s.limitCents)}</Detail>
                <Detail label="People">{count(s.participants)}</Detail>
                <Detail label="Alcohol">{ALCOHOL[s.alcohol]}</Detail>
              </dl>
            </CardBody>
          </Card>

          <Card aria-label="Certificates of insurance">
            <CardHeader
              title="Certificates of insurance"
              note="One for each party that needs proof of cover."
            />
            <ul className="divide-y divide-line">
              {certificates.map((certificate) => (
                <li key={certificate.holder}>
                  <a
                    href={`/api/portal/${program.code}/certificates/${policy.id}/${certificate.holder}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-3 px-5 py-3 transition-colors duration-150 hover:bg-sunken/60"
                  >
                    <FileText className="size-5 shrink-0 text-brand" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-ink">{certificate.who}</span>
                      <span className="block text-sm text-ink-faint">{certificate.role}</span>
                    </span>
                    <span className="text-sm font-medium text-brand">Open PDF</span>
                  </a>
                </li>
              ))}
            </ul>
            {s.routed ? null : (
              <p className="border-t border-line px-5 py-3 text-sm text-ink-faint">
                No booking reference identified the booking, so the venue and its broker were not
                sent a certificate. The platform raised an event for that, so someone can follow up.
              </p>
            )}
          </Card>
        </section>

        <aside>
          <Card>
            <CardHeader
              title="Something happened?"
              note={`Covered: ${day(policy.startsAt)}${
                day(policy.endsAt) === day(policy.startsAt) ? '' : ` to ${day(policy.endsAt)}`
              }.`}
            />
            <CardBody>
              <ClaimForm
                action={reportLoss.bind(null, program.code, policy.id)}
                lossDate={policy.startsAt.slice(0, 10)}
                reporter={s.holder}
                idem={randomUUID()}
              />
            </CardBody>
          </Card>
        </aside>
      </div>
    </>
  );
}
