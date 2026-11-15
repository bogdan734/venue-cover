import { Paperclip } from 'lucide-react';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { stamp } from '@/lib/format';
import type { InboxMessage } from '@/lib/renter';
import { safeNext } from '@/lib/session';

// A link in a mail is followed only to a page of this site or to a web address, never to a script.
function linkOf(url: string): string | null {
  if (url.startsWith('/')) return safeNext(url) === url ? url : null;
  return /^https?:\/\//.test(url) ? url : null;
}

export function MailCard({ message }: { message: InboxMessage }) {
  const link = message.action ? linkOf(message.action.url) : null;
  return (
    <Card as="article" aria-label={message.subject}>
      <CardHeader
        title={message.subject}
        note={`To ${message.to} · ${stamp(message.at)}`}
        aside={
          message.attachment ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-sunken px-2.5 py-0.5 font-mono text-[0.75rem] text-ink-soft">
              <Paperclip className="size-3.5" aria-hidden />
              {message.attachment}
            </span>
          ) : null
        }
      />
      <CardBody>
        <p className="text-[0.95rem] whitespace-pre-line text-ink-soft">{message.body}</p>
        {message.action && link ? (
          <ButtonLink href={link} className="mt-4">
            {message.action.label}
          </ButtonLink>
        ) : null}
      </CardBody>
    </Card>
  );
}
