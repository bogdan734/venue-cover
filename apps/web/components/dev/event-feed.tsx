'use client';

import { useEffect, useState } from 'react';
import { Badge, type Tone } from '@/components/ui/badge';
import { stamp } from '@/lib/format';

interface FeedEvent {
  id: string;
  type: string;
  programId: string;
  occurredAt: string;
  data: Record<string, unknown>;
}

const TONES: Record<string, Tone> = {
  'quote.created': 'neutral',
  'quote.referred': 'warn',
  'referral.decided': 'info',
  'policy.issued': 'ok',
  'certificate.ready': 'ok',
  'certificate.unrouted': 'warn',
  'claim.reported': 'danger',
  'program.rules_published': 'brand',
  'webhook.delivery.failed': 'danger',
};

// The same events a webhook receives, as they happen. The browser reconnects by itself and resumes from the last
// event it saw, because every frame carries its sequence number.
export function EventFeed({ programs }: { programs: Record<string, string> }) {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const source = new EventSource('/api/stream');
    source.onopen = () => setLive(true);
    source.onerror = () => setLive(false);
    const take = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as FeedEvent;
      setEvents((current) => [event, ...current.filter((e) => e.id !== event.id)].slice(0, 60));
    };
    for (const type of Object.keys(TONES)) source.addEventListener(type, take as EventListener);
    return () => source.close();
  }, []);

  return (
    <div>
      <p className="flex items-center gap-2 px-5 py-2.5 text-sm text-ink-soft" role="status">
        <span className={`size-2 rounded-full ${live ? 'bg-ok' : 'bg-line-strong'}`} aria-hidden />
        {live ? 'Live' : 'Connecting…'}
        <span className="text-ink-faint">· events appear as they happen</span>
      </p>
      {events.length === 0 ? (
        <p className="border-t border-line px-5 py-10 text-center text-sm text-ink-faint">
          Nothing yet. Buy a policy on a client portal, or decide a referral, and the event shows up
          here.
        </p>
      ) : (
        <ol
          className="max-h-[34rem] divide-y divide-line overflow-y-auto border-t border-line"
          aria-label="Events"
        >
          {events.map((event) => (
            <li key={event.id} className="px-5 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={TONES[event.type] ?? 'neutral'}>{event.type}</Badge>
                <span className="font-mono text-[0.75rem] text-ink-faint">
                  {programs[event.programId] ?? event.programId}
                </span>
                <span className="ml-auto text-[0.78rem] text-ink-faint">
                  {stamp(event.occurredAt)}
                </span>
              </div>
              <pre className="mt-1.5 overflow-x-auto font-mono text-[0.78rem] leading-relaxed text-ink-soft">
                {JSON.stringify(event.data)}
              </pre>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
