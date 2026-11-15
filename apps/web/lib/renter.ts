import 'server-only';
import { cookies, headers } from 'next/headers';
import { type Actor, ApiError, api } from './api';

// The renter's side of the portal. The API's session token lives in an HttpOnly cookie and goes back to the API in the
// Renter-Session header; the browser's scripts never see it.

const SESSION_COOKIE = 'venue_renter';
const INBOX_COOKIE = 'venue_inbox';
const RETURN_COOKIE = 'venue_return';
const SESSION_SECONDS = 14 * 86_400;

export interface Renter {
  id: string;
  email: string;
  name: string;
  verified: boolean;
  createdAt: string;
}

export interface RenterQuote {
  id: string;
  programId: string;
  state: string;
  activityTitle: string;
  eventDate: string;
  totalCents: number | null;
  createdAt: string;
  policy: { id: string; policyNumber: string } | null;
}

export interface InboxMessage {
  id: number;
  to: string;
  subject: string;
  body: string;
  action: { label: string; url: string } | null;
  attachment: string | null;
  at: string;
}

async function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: (await headers()).get('x-forwarded-proto') === 'https',
    path: '/',
    maxAge,
  };
}

export async function sessionHeader(): Promise<Record<string, string>> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? { 'renter-session': token } : {};
}

export async function keepSession(token: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, await cookieOptions(SESSION_SECONDS));
}

export async function dropSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

// The signed-in renter, or null. A session the API no longer knows reads as signed out.
export async function currentRenter(as: Actor): Promise<Renter | null> {
  const session = await sessionHeader();
  if (!session['renter-session']) return null;
  try {
    return await api<Renter>(as, '/v1/renters/me', { headers: session });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

// Where a renter who left to create an account goes once the e-mail is confirmed: the price they were about to pay.
// The confirmation link comes from the mail, so the way back has to wait in the browser.
export async function rememberReturn(path: string | null): Promise<void> {
  const jar = await cookies();
  if (path) jar.set(RETURN_COOKIE, path, await cookieOptions(3_600));
  else jar.delete(RETURN_COOKIE);
}

export async function takeReturn(): Promise<string | undefined> {
  const jar = await cookies();
  const path = jar.get(RETURN_COOKIE)?.value;
  jar.delete(RETURN_COOKIE);
  return path;
}

// The demo inbox: this browser's key to the simulated mailbox of the address it registered. The API gives the key only
// to the first browser that claims an address, so typing someone else's address shows nothing of theirs.
export async function claimInbox(email: string): Promise<void> {
  const address = email.trim().toLowerCase();
  try {
    const { key } = await api<{ key: string }>('operator', '/v1/demo/mailboxes', {
      method: 'POST',
      body: { address },
    });
    (await cookies()).set(INBOX_COOKIE, `${key}:${address}`, await cookieOptions(SESSION_SECONDS));
  } catch (error) {
    // Taken, by this browser earlier or by another one: either way the cookie stays as it is.
    if (error instanceof ApiError && error.code === 'mailbox_taken') return;
    throw error;
  }
}

async function inboxKey(): Promise<{ key: string; address: string } | null> {
  const value = (await cookies()).get(INBOX_COOKIE)?.value ?? '';
  const at = value.indexOf(':');
  return at > 0 ? { key: value.slice(0, at), address: value.slice(at + 1) } : null;
}

export async function hasInbox(): Promise<boolean> {
  return (await inboxKey()) !== null;
}

export async function inbox(): Promise<{ address: string; messages: InboxMessage[] } | null> {
  const box = await inboxKey();
  if (!box) return null;
  try {
    const { messages } = await api<{ messages: InboxMessage[] }>(
      'operator',
      `/v1/demo/mailbox?to=${encodeURIComponent(box.address)}`,
      { headers: { 'mailbox-key': box.key } },
    );
    return { address: box.address, messages };
  } catch (error) {
    // The API was restarted and forgot the claim: the key opens nothing any more.
    if (error instanceof ApiError && error.code === 'not_your_mailbox') return null;
    throw error;
  }
}
