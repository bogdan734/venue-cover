'use client';

import { MessageCircle, Send, X } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { cx } from '@/lib/cx';
import type { Chat, ChatLine } from '@/lib/types';

const PROMPTS = [
  'What is covered?',
  'How do I get a price?',
  'Where is my policy?',
  'Talk to a person',
];
const POLL_MS = 3000;

function stateLine(state: Chat['state'] | undefined, name: string): string {
  switch (state) {
    case 'waiting':
      return `Waiting for a person at ${name}. You can keep writing.`;
    case 'human':
      return `A person at ${name} is answering.`;
    case 'closed':
      return 'This conversation was closed. Write to start again.';
    default:
      return 'An assistant answers from this portal’s own rules. Ask for a person any time.';
  }
}

const who = (sender: ChatLine['sender'], name: string) =>
  sender === 'bot' ? 'Assistant' : sender === 'staff' ? name : 'You';

// The portal's help chat: closed to a button until asked for, then a panel that polls for answers while it is open. The
// bot answers from the program's data; a person takes over in the staff inbox, and this panel says which is the case.
export function PortalChat({
  code,
  name,
  telegram,
}: {
  code: string;
  name: string;
  telegram: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [chat, setChat] = useState<Chat | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string>();
  const input = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const endpoint = `/api/portal/${code}/chat`;

  const merge = useCallback((next: Chat | null) => {
    if (!next) return;
    setChat((current) => {
      if (!current || current.id !== next.id) return next;
      const seen = new Set(current.messages.map((m) => m.id));
      return {
        ...next,
        messages: [...current.messages, ...next.messages.filter((m) => !seen.has(m.id))],
      };
    });
  }, []);

  async function post(body: object) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`the chat answered ${response.status}`);
    merge((await response.json()) as Chat);
  }

  // Opening shows the conversation this browser already has, or starts one: the assistant says what it can do.
  function openChat() {
    setOpen(true);
    if (!chat) {
      post({}).catch(() => setProblem('The chat could not be opened. Try again in a moment.'));
    }
  }

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  // New lines from the assistant or a person, while the panel is open.
  useEffect(() => {
    if (!open || !chat) return;
    const timer = setInterval(async () => {
      const last = chat.messages.at(-1)?.at;
      const response = await fetch(
        `${endpoint}${last ? `?after=${encodeURIComponent(last)}` : ''}`,
      );
      if (response.ok) merge((await response.json()) as Chat | null);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [open, chat, endpoint, merge]);

  useEffect(() => {
    list.current?.lastElementChild?.scrollIntoView({ block: 'end' });
  });

  async function say(line: string) {
    const trimmed = line.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setProblem(undefined);
    try {
      await post({ text: trimmed });
      setText('');
    } catch {
      setProblem('That did not go through. Try again.');
    } finally {
      setSending(false);
      input.current?.focus();
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void say(text);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={openChat}
        className="fixed right-4 bottom-4 z-40 inline-flex h-12 items-center gap-2 rounded-full bg-brand px-5 font-medium text-white shadow-[0_6px_24px_-6px_rgb(22_32_51/0.45)] transition-[background-color,transform] duration-200 ease-out hover:bg-brand-strong motion-safe:hover:-translate-y-0.5"
      >
        <MessageCircle className="size-5" aria-hidden /> Questions? Ask us
      </button>
    );
  }

  const greeted = (chat?.messages.length ?? 0) <= 1;
  return (
    <section
      aria-label={`Chat with ${name}`}
      onKeyDown={(event) => event.key === 'Escape' && setOpen(false)}
      className="chat-in fixed inset-x-3 bottom-3 z-40 flex max-h-[min(36rem,calc(100dvh-1.5rem))] flex-col overflow-hidden rounded-card border border-line bg-surface shadow-[0_18px_48px_-12px_rgb(22_32_51/0.35)] sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[23rem]"
    >
      <header className="flex items-start justify-between gap-3 border-t-4 border-b border-t-brand border-b-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-[0.98rem] font-semibold text-ink">{name}</h2>
          <p className="text-[0.8rem] leading-snug text-ink-faint" aria-live="polite">
            {stateLine(chat?.state, name)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-control p-1 text-ink-faint hover:bg-sunken hover:text-ink"
        >
          <X className="size-5" aria-hidden />
          <span className="sr-only">Close the chat</span>
        </button>
      </header>

      <ol ref={list} aria-live="polite" className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {chat?.messages.map((line) => (
          <li
            key={line.id}
            className={cx('flex flex-col', line.sender === 'renter' ? 'items-end' : 'items-start')}
          >
            <span className="mb-0.5 text-[0.72rem] font-medium text-ink-faint">
              {who(line.sender, name)}
            </span>
            <p
              className={cx(
                'max-w-[85%] rounded-card px-3 py-2 text-[0.9rem] leading-relaxed whitespace-pre-line',
                line.sender === 'renter'
                  ? 'rounded-br-sm bg-brand text-white'
                  : line.sender === 'staff'
                    ? 'rounded-bl-sm border border-brand/30 bg-brand-soft text-ink'
                    : 'rounded-bl-sm bg-sunken text-ink',
              )}
            >
              {line.text}
            </p>
          </li>
        ))}
        {!chat && !problem ? <li className="text-sm text-ink-faint">Opening…</li> : null}
      </ol>

      {greeted && chat ? (
        <div className="flex flex-wrap gap-1.5 px-4 pb-2">
          {PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => void say(prompt)}
              disabled={sending}
              className="rounded-full border border-line-strong px-2.5 py-1 text-[0.8rem] text-ink-soft transition-colors duration-150 hover:border-brand hover:text-brand"
            >
              {prompt}
            </button>
          ))}
        </div>
      ) : null}

      {problem ? (
        <p role="alert" className="px-4 pb-2 text-sm text-danger">
          {problem}
        </p>
      ) : null}

      <form onSubmit={onSubmit} className="flex items-end gap-2 border-t border-line px-3 py-3">
        <label htmlFor="chat-text" className="sr-only">
          Your message
        </label>
        <textarea
          id="chat-text"
          ref={input}
          rows={1}
          value={text}
          maxLength={2000}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void say(text);
            }
          }}
          placeholder="Write a message"
          className="max-h-28 min-h-10 flex-1 resize-none rounded-control border border-line-strong bg-surface px-3 py-2 text-[0.92rem] text-ink placeholder:text-ink-faint focus:border-brand focus:outline-2 focus:outline-brand/25"
        />
        <button
          type="submit"
          disabled={sending || !text.trim()}
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-control bg-brand text-white transition-colors duration-150 hover:bg-brand-strong disabled:opacity-50"
        >
          <Send className="size-4" aria-hidden />
          <span className="sr-only">Send</span>
        </button>
      </form>
      {telegram ? (
        <p className="border-t border-line px-4 py-2 text-[0.78rem] text-ink-faint">
          Prefer Telegram?{' '}
          <a
            href={`https://t.me/${telegram}?start=${code}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-brand hover:underline"
          >
            Continue there
          </a>
          , with the same assistant and people.
        </p>
      ) : null}
    </section>
  );
}
