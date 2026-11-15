import { DescribeForm } from '@/components/portal/describe-form';
import { Steps } from '@/components/portal/steps';
import { Card, Label } from '@/components/ui/card';
import { portalOf } from '@/lib/portal';
import { rulesInWords } from '@/lib/words';
import { EVENT_EXAMPLES } from '../../../../../data/examples';
import { describe } from './actions';

export default async function PortalHome({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { program, rules } = await portalOf(code);

  return (
    <>
      <Steps current="Describe" />
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <section aria-labelledby="describe">
          <h1 id="describe" className="text-[2.1rem] text-ink">
            Tell us about your event
          </h1>
          {program.theme?.welcome ? (
            <p className="mt-2 max-w-xl text-ink">{program.theme.welcome}</p>
          ) : null}
          <p className="mt-2 max-w-xl text-ink-soft">
            In your own words, in English or French. We work out what it is, show you how we read
            it, and ask only for what is missing.
          </p>
          <div className="mt-6">
            {program.status === 'paused' ? (
              <p className="rounded-card border border-line bg-surface px-5 py-4 text-ink-soft">
                New quotes are closed for now. Come back later, or use the contacts below.
              </p>
            ) : (
              <DescribeForm action={describe.bind(null, program.code)} examples={EVENT_EXAMPLES} />
            )}
          </div>
        </section>

        <aside>
          <Card className="p-5">
            <Label>Priced on the spot here</Label>
            <ul className="mt-3 space-y-2 text-[0.92rem] text-ink-soft">
              {rulesInWords(rules).map((line) => (
                <li key={line} className="flex gap-2.5">
                  <span
                    className="mt-[0.55em] size-1.5 shrink-0 rounded-full bg-brand"
                    aria-hidden
                  />
                  {line}
                </li>
              ))}
            </ul>
            <p className="mt-4 border-t border-line pt-3 text-[0.82rem] text-ink-faint">
              Anything else goes to an underwriter with the reasons. These are this program’s own
              rules; another program’s portal has its own.
            </p>
          </Card>
        </aside>
      </div>
    </>
  );
}
