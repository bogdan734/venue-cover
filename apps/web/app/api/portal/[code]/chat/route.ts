import { randomUUID } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { type Actor, ApiError, api } from '@/lib/api';
import { portalOf } from '@/lib/portal';
import { sessionHeader } from '@/lib/renter';
import type { Chat, ChatLine } from '@/lib/types';

// The portal chat, between the browser and the API. The browser holds the conversation's secret in an HttpOnly cookie
// for this portal; the API key stays on the server, as everywhere else.
const cookieName = (code: string) => `venue_chat_${code}`;
const DAYS_30 = 30 * 24 * 3600;

type Held = { id: string; key: string };

async function held(code: string): Promise<Held | null> {
  const [id, key] = ((await cookies()).get(cookieName(code))?.value ?? '').split(':');
  return id && key ? { id, key } : null;
}

async function hold(code: string, chat: Held): Promise<void> {
  (await cookies()).set(cookieName(code), `${chat.id}:${chat.key}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: (await headers()).get('x-forwarded-proto') === 'https',
    path: '/',
    maxAge: DAYS_30,
  });
}

async function read(as: Actor, chat: Held, after?: string): Promise<Chat | null> {
  try {
    return await api<Chat>(
      as,
      `/v1/conversations/${chat.id}${after ? `?after=${encodeURIComponent(after)}` : ''}`,
      { headers: { 'conversation-key': chat.key } },
    );
  } catch (error) {
    // A conversation from a database that was replaced since: start again.
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

// The lines after `after`, or the whole conversation; nothing until the renter opens the chat.
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { program, as } = await portalOf((await params).code);
  const chat = await held(program.code);
  const after = new URL(request.url).searchParams.get('after') ?? undefined;
  return Response.json((chat && (await read(as, chat, after))) ?? null);
}

// `{}` opens the chat (the bot says hello); `{ text }` writes in it, opening it first when needed.
export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { program, as } = await portalOf((await params).code);
  const body = (await request.json().catch(() => ({}))) as { text?: unknown };
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, 2000) : '';

  let chat = await held(program.code);
  let opened: Chat | null = chat ? await read(as, chat) : null;
  if (!chat || !opened) {
    const created = await api<Chat & { key: string }>(as, '/v1/conversations', {
      method: 'POST',
      idempotencyKey: randomUUID(),
    });
    chat = { id: created.id, key: created.key };
    await hold(program.code, chat);
    opened = { id: created.id, state: created.state, messages: created.messages };
  }
  if (!text) return Response.json(opened);

  const send = (withSession: Record<string, string>) =>
    api<{ state: Chat['state']; messages: ChatLine[] }>(
      as,
      `/v1/conversations/${(chat as Held).id}/messages`,
      {
        method: 'POST',
        idempotencyKey: randomUUID(),
        body: { text },
        headers: { 'conversation-key': (chat as Held).key, ...withSession },
      },
    );
  let answered: Awaited<ReturnType<typeof send>>;
  try {
    answered = await send(await sessionHeader());
  } catch (error) {
    // A session that has ended does not stop someone from asking a question.
    if (!(error instanceof ApiError && error.code === 'invalid_session')) throw error;
    answered = await send({});
  }
  return Response.json({ id: chat.id, state: answered.state, messages: answered.messages });
}
