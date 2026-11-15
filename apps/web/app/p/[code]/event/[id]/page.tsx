import { randomUUID } from 'node:crypto';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { type ActivityOption, ConfirmForm } from '@/components/portal/confirm-form';
import { Steps } from '@/components/portal/steps';
import { Trace } from '@/components/trace';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ApiError, api } from '@/lib/api';
import { portalOf } from '@/lib/portal';
import { currentRenter } from '@/lib/renter';
import type { ClassificationView, Questions } from '@/lib/types';
import { questionsFor, requestQuote } from '../../actions';

export const metadata: Metadata = { title: 'Confirm the details' };

// The activities the description points at, the one that prices the event first, each once.
function optionsOf(c: ClassificationView): ActivityOption[] {
  const seen = new Set<string>();
  const ordered = [
    ...(c.primary ? [c.primary] : []),
    ...c.phrases.flatMap((p) => (p.accepted ? [p.accepted] : [])),
    ...c.phrases.flatMap((p) => p.candidates),
  ];
  return ordered.flatMap((match) => {
    if (seen.has(match.activityId)) return [];
    seen.add(match.activityId);
    return [{ activityId: match.activityId, title: match.title, riskClass: match.riskClass }];
  });
}

export default async function EventPage({
  params,
}: {
  params: Promise<{ code: string; id: string }>;
}) {
  const { code, id } = await params;
  const { program, rules, as } = await portalOf(code);

  let classification: ClassificationView;
  try {
    classification = await api<ClassificationView>(as, `/v1/intake/classifications/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const [questions, renter] = await Promise.all([
    api<Questions>(as, '/v1/intake/questions', {
      method: 'POST',
      body: { classificationId: id },
    }),
    currentRenter(as),
  ]);
  const inAMonth = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

  return (
    <>
      <Steps current="Confirm" />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <section aria-labelledby="understood">
          <h1 id="understood" className="text-[2.1rem] text-ink">
            Here is how we read it
          </h1>
          <p className="mt-2 max-w-xl text-ink-soft">
            Every step is shown, so you can see where a detail went wrong and correct it on the
            right.{' '}
            <Link href={`/p/${program.code}`} className="text-brand hover:underline">
              Start again
            </Link>
          </p>
          <Card className="mt-6 p-6">
            <Trace
              read={classification}
              verdict={{
                auto: classification.decision.outcome === 'auto',
                reasons: classification.decision.reasons,
              }}
            />
          </Card>
          <p className="mt-3 text-sm text-ink-faint">
            This verdict is from the description alone. The final check uses the details you
            confirm, your answers and your name.
          </p>
        </section>

        <aside>
          <Card className="lg:sticky lg:top-6">
            <CardHeader title="Confirm the details" note="Correct anything we got wrong." />
            <CardBody>
              <ConfirmForm
                code={program.code}
                action={requestQuote.bind(null, program.code, id)}
                ask={questionsFor.bind(null, program.code, id)}
                options={optionsOf(classification)}
                facts={classification.facts}
                limits={rules.limitsCents}
                defaultDate={inAMonth}
                questions={questions.open}
                holder={renter ? { name: renter.name, email: renter.email } : null}
                idem={randomUUID()}
              />
            </CardBody>
          </Card>
        </aside>
      </div>
    </>
  );
}
