import type { Metadata } from 'next';
import Link from 'next/link';
import { AutoRefresh } from '@/components/auto-refresh';
import { MailCard } from '@/components/portal/mail-card';
import { Card, Empty } from '@/components/ui/card';
import { portalOf } from '@/lib/portal';
import { inbox } from '@/lib/renter';

export const metadata: Metadata = { title: 'Demo inbox' };

// No e-mail leaves the demo, so the mail the platform sends shows up here: only in the browser that registered the
// address first, the demo's stand-in for owning the mailbox.
export default async function InboxPage({ params }: { params: Promise<{ code: string }> }) {
  const { program } = await portalOf((await params).code);
  const box = await inbox();

  return (
    <section aria-labelledby="inbox" className="mx-auto max-w-2xl">
      <AutoRefresh seconds={4} />
      <p className="text-sm font-medium text-brand">Demo inbox</p>
      <h1 id="inbox" className="mt-1.5 text-[2.1rem] text-ink">
        Your mail
      </h1>
      <p className="mt-2 text-ink-soft">
        No e-mail leaves this demo. What the platform would send
        {box ? (
          <>
            {' '}
            to <span className="font-medium text-ink">{box.address}</span>
          </>
        ) : null}{' '}
        appears here instead, as soon as it is sent.
      </p>

      <div className="mt-6 space-y-4">
        {box && box.messages.length > 0 ? (
          box.messages.map((message) => <MailCard key={message.id} message={message} />)
        ) : (
          <Card>
            {box ? (
              <Empty title="Nothing yet">New mail shows up here within a few seconds.</Empty>
            ) : (
              <Empty title="This browser has no inbox yet">
                It opens when you{' '}
                <Link
                  href={`/p/${program.code}/account/register`}
                  className="font-medium text-brand hover:underline"
                >
                  create an account
                </Link>
                . An address someone else used first in this demo keeps its mail to them: pick
                another.
              </Empty>
            )}
          </Card>
        )}
      </div>
    </section>
  );
}
