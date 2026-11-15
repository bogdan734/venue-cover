import { randomUUID } from 'node:crypto';
import { ArrowUpRight, Bot, Send as TelegramIcon, UserRound } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AutoRefresh } from '@/components/auto-refresh';
import { ReplyForm } from '@/components/inbox/reply-form';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, Empty, Label } from '@/components/ui/card';
import { api } from '@/lib/api';
import { cx } from '@/lib/cx';
import { day, relative } from '@/lib/format';
import type { ChatLine, ConversationState, InboxDetail, InboxItem } from '@/lib/types';
import { CHAT_STATE, HANDOVER } from '@/lib/words';
import { moveConversation, reply } from './actions';

export const metadata: Metadata = { title: 'Inbox' };

const SENDER: Record<ChatLine['sender'], string> = {
  renter: 'Renter',
  bot: 'Assistant',
  staff: 'Staff',
};

function Move({
  id,
  to,
  label,
  variant = 'secondary',
}: {
  id: string;
  to: ConversationState;
  label: string;
  variant?: 'primary' | 'secondary' | 'quiet';
}) {
  return (
    <form action={moveConversation.bind(null, id)}>
      <input type="hidden" name="to" value={to} />
      <Button type="submit" variant={variant} size="sm">
        {label}
      </Button>
    </form>
  );
}

function Thread({ detail, now }: { detail: InboxDetail; now: Date }) {
  const { context } = detail;
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_17rem]">
      <Card aria-label="Conversation">
        <CardHeader
          title={detail.program.name}
          note={`${detail.channel === 'telegram' ? 'Telegram' : 'Portal chat'} · started ${relative(detail.createdAt, now)}`}
          aside={
            <>
              {detail.state !== 'human' ? (
                <Move id={detail.id} to="human" label="Take over" />
              ) : null}
              {detail.state !== 'bot' && detail.state !== 'closed' ? (
                <Move id={detail.id} to="bot" label="Give back to the assistant" variant="quiet" />
              ) : null}
              {detail.state !== 'closed' ? (
                <Move id={detail.id} to="closed" label="Close" variant="quiet" />
              ) : null}
            </>
          }
        />
        <ol className="space-y-3 px-5 py-4" aria-live="polite">
          {detail.messages.map((line) => (
            <li
              key={line.id}
              className={cx(
                'flex flex-col',
                line.sender === 'renter' ? 'items-start' : 'items-end',
              )}
            >
              <span className="mb-0.5 text-[0.75rem] text-ink-faint">
                {SENDER[line.sender]} · <time dateTime={line.at}>{relative(line.at, now)}</time>
              </span>
              <p
                className={cx(
                  'max-w-[80%] rounded-card px-3.5 py-2 text-[0.92rem] leading-relaxed whitespace-pre-line',
                  line.sender === 'renter'
                    ? 'rounded-bl-sm border border-line bg-surface text-ink'
                    : line.sender === 'staff'
                      ? 'rounded-br-sm bg-brand text-white'
                      : 'rounded-br-sm bg-sunken text-ink-soft',
                )}
              >
                {line.text}
              </p>
            </li>
          ))}
        </ol>
        <CardBody className="border-t border-line">
          <ReplyForm action={reply.bind(null, detail.id)} idem={randomUUID()} />
        </CardBody>
      </Card>

      <Card as="aside" aria-label="The case">
        <CardHeader title="The case" />
        <CardBody>
          <dl className="space-y-3 text-[0.92rem]">
            <div>
              <dt>
                <Label>Who has it</Label>
              </dt>
              <dd className="mt-1">
                <Badge tone={CHAT_STATE[detail.state].tone}>{CHAT_STATE[detail.state].word}</Badge>
              </dd>
            </div>
            {context.reason ? (
              <div>
                <dt>
                  <Label>Handed over</Label>
                </dt>
                <dd className="mt-0.5 text-ink">
                  {HANDOVER[context.reason] ?? context.reason}
                  {context.handedOverAt ? (
                    <span className="block text-[0.8rem] text-ink-faint">
                      {relative(context.handedOverAt, now)}
                    </span>
                  ) : null}
                </dd>
              </div>
            ) : null}
            {context.policy ? (
              <div>
                <dt>
                  <Label>Policy</Label>
                </dt>
                <dd className="mt-0.5">
                  <Link
                    href={`/p/${detail.program.code}/policy/${context.policy.id}`}
                    className="inline-flex items-center gap-1 font-medium text-brand hover:underline"
                  >
                    {context.policy.policyNumber} <ArrowUpRight className="size-3.5" aria-hidden />
                  </Link>
                  <span className="block text-[0.8rem] text-ink-faint">
                    {day(context.policy.startsAt)} to {day(context.policy.endsAt)}
                  </span>
                </dd>
              </div>
            ) : null}
            <div>
              <dt>
                <Label>Renter</Label>
              </dt>
              <dd className="mt-0.5 text-ink-soft">
                {detail.signedIn ? 'Signed in on the portal' : 'Not signed in'}
              </dd>
            </div>
          </dl>
          <p className="mt-4 border-t border-line pt-3 text-[0.8rem] text-ink-faint">
            Personal details are stored as tags and sealed; they show here because this console may
            read them. The assistant’s model only ever saw the tags.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

// Every conversation from the portals and Telegram, the ones waiting for a person first. Opening one shows the case
// the assistant handed over with.
export default async function Inbox({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const selected = (await searchParams).c;
  const [{ conversations }, detail] = await Promise.all([
    api<{ conversations: InboxItem[] }>('operator', '/v1/inbox'),
    selected ? api<InboxDetail>('operator', `/v1/inbox/${encodeURIComponent(selected)}`) : null,
  ]);
  const now = new Date();
  const waiting = conversations.filter((c) => c.state === 'waiting').length;

  return (
    <>
      <AutoRefresh seconds={4} />
      <PageHeader title="Inbox">
        What renters wrote on the portals and in Telegram. The assistant answers from each program’s
        rules and the renter’s own policy; it hands over a claim, a refund, a request for a person
        or anything it cannot answer, with the case attached.{' '}
        {waiting > 0 ? `${waiting} waiting for a person.` : 'Nobody is waiting.'}
      </PageHeader>
      <div className="grid items-start gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <Card aria-label="Conversations">
          {conversations.length === 0 ? (
            <Empty title="No conversations yet">
              Open a portal, press “Questions? Ask us” and write; it shows here.
            </Empty>
          ) : (
            <ul className="divide-y divide-line">
              {conversations.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/inbox?c=${c.id}`}
                    aria-current={c.id === selected ? 'page' : undefined}
                    className={cx(
                      'block px-4 py-3 transition-colors duration-150 hover:bg-sunken/60',
                      c.id === selected && 'bg-brand-soft/60',
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5 text-[0.9rem] font-medium text-ink">
                        {c.channel === 'telegram' ? (
                          <TelegramIcon
                            className="size-3.5 shrink-0 text-ink-faint"
                            aria-label="Telegram"
                          />
                        ) : c.signedIn ? (
                          <UserRound
                            className="size-3.5 shrink-0 text-ink-faint"
                            aria-label="Signed in"
                          />
                        ) : (
                          <Bot className="size-3.5 shrink-0 text-ink-faint" aria-hidden />
                        )}
                        <span className="truncate">{c.program.name}</span>
                      </span>
                      <Badge tone={CHAT_STATE[c.state].tone}>{CHAT_STATE[c.state].word}</Badge>
                    </span>
                    <span className="mt-1 line-clamp-2 block text-[0.84rem] text-ink-soft">
                      {c.last ? `${SENDER[c.last.sender]}: ${c.last.text}` : '—'}
                    </span>
                    <span className="mt-1 block text-[0.75rem] text-ink-faint">
                      {c.reason ? `${HANDOVER[c.reason] ?? c.reason} · ` : ''}
                      {relative(c.updatedAt, now)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {detail ? (
          <Thread detail={detail} now={now} />
        ) : (
          <Card>
            <Empty title="Pick a conversation">
              The ones waiting for a person are at the top of the list.
            </Empty>
          </Card>
        )}
      </div>
    </>
  );
}
