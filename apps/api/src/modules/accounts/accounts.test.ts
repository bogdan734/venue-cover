import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, NOW, type TestApp } from '../../../test/app.js';
import { hashToken } from './tokens.js';

let t: TestApp;
let portal: string; // program 1's portal key
let operator: string;
let counter = 0;

beforeAll(async () => {
  t = await createTestApp();
  portal = await t.keyFor('prg_1', ['quotes:read', 'quotes:write', 'personal:read']);
  operator = await t.keyFor(null, ['mail:read']);
});
afterAll(() => t.close());

const call = (
  method: 'GET' | 'POST' | 'DELETE',
  url: string,
  options: { body?: object; session?: string; key?: string; headers?: Record<string, string> } = {},
) =>
  t.app.inject({
    method,
    url,
    headers: {
      authorization: `Bearer ${options.key ?? portal}`,
      ...(options.session ? { 'renter-session': options.session } : {}),
      ...options.headers,
      ...(url === '/v1/quotes' || url.endsWith('/bind')
        ? { 'idempotency-key': `a-${++counter}` }
        : {}),
    },
    ...(options.body ? { payload: options.body } : {}),
  });

const address = () => `renter${++counter}@example.org`;
const PASSWORD = 'a long enough password';
const mailTo = (to: string) => t.mail.sent.filter((m) => m.to === to);
// The token is the end of the confirmation link in the last mail to the address.
const linkToken = (to: string) => {
  const url = mailTo(to).at(-1)?.action?.url ?? '';
  return new URL(url, 'http://portal.test').searchParams.get('token') ?? '';
};

async function confirmedRenter(email = address()) {
  await call('POST', '/v1/renters', { body: { email, name: 'Pat Renter', password: PASSWORD } });
  const verified = await call('POST', '/v1/renters/verify', { body: { token: linkToken(email) } });
  return {
    email,
    session: verified.json().token as string,
    id: verified.json().renter.id as string,
  };
}

describe('registering', () => {
  it('answers alike for a new and a taken address, and mails each a different message', async () => {
    const email = address();
    const first = await call('POST', '/v1/renters', {
      body: { email, name: 'Pat', password: PASSWORD },
    });
    const again = await call('POST', '/v1/renters', {
      body: { email: email.toUpperCase(), name: 'Someone', password: 'another long password' },
    });
    expect(first.statusCode).toBe(202);
    expect(again.statusCode).toBe(202);
    expect(again.json()).toEqual(first.json());
    expect(first.json()).toEqual({ status: 'check_your_email' });

    const mails = mailTo(email);
    expect(mails).toHaveLength(2); // an unconfirmed address gets a fresh link; nothing reveals it to the caller
    expect(mails[0]?.subject).toContain('Confirm');
    expect(mails[0]?.action?.url).toMatch(/^\/p\/FHV\/verify\?token=[A-Za-z0-9_-]{40,}$/);

    const { email: taken } = await confirmedRenter();
    await call('POST', '/v1/renters', { body: { email: taken, name: 'Pat', password: PASSWORD } });
    expect(mailTo(taken).at(-1)?.subject).toBe('You already have an account');
  });

  it('keeps the first password: registering again with a taken address changes nothing', async () => {
    const { email } = await confirmedRenter();
    await call('POST', '/v1/renters', {
      body: { email, name: 'Thief', password: 'the thief password' },
    });
    expect(
      (
        await call('POST', '/v1/renters/sessions', {
          body: { email, password: 'the thief password' },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (await call('POST', '/v1/renters/sessions', { body: { email, password: PASSWORD } }))
        .statusCode,
    ).toBe(200);
  });

  it('refuses a short password, an address that is not one, and a key without a program', async () => {
    expect(
      (
        await call('POST', '/v1/renters', {
          body: { email: address(), name: 'Pat', password: 'short' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call('POST', '/v1/renters', {
          body: { email: 'nope', name: 'Pat', password: PASSWORD },
        })
      ).statusCode,
    ).toBe(400);
    const unbound = await t.keyFor(null, ['quotes:write']);
    expect(
      (
        await call('POST', '/v1/renters', {
          key: unbound,
          body: { email: address(), name: 'Pat', password: PASSWORD },
        })
      ).statusCode,
    ).toBe(403);
  });

  it('stores a scrypt hash and the hashes of tokens, never the password or a token', async () => {
    const email = address();
    await call('POST', '/v1/renters', { body: { email, name: 'Pat', password: PASSWORD } });
    const token = linkToken(email);
    const renter = await t.db
      .selectFrom('renter')
      .selectAll()
      .where('email', '=', email)
      .executeTakeFirstOrThrow();
    expect(renter.password_hash).toMatch(/^scrypt\$/);
    expect(JSON.stringify(renter)).not.toContain(PASSWORD);
    const tokens = await t.db
      .selectFrom('renter_token')
      .selectAll()
      .where('renter_id', '=', renter.id)
      .execute();
    expect(tokens.map((x) => x.token_hash)).toEqual([hashToken(token)]);
    expect(JSON.stringify(tokens)).not.toContain(token);
  });
});

describe('confirming', () => {
  it('signs in once with the link, and the link does not work twice', async () => {
    const email = address();
    await call('POST', '/v1/renters', { body: { email, name: 'Pat Renter', password: PASSWORD } });
    const token = linkToken(email);
    const first = await call('POST', '/v1/renters/verify', { body: { token } });
    expect(first.statusCode).toBe(200);
    expect(first.json().renter).toMatchObject({ email, name: 'Pat Renter', verified: true });
    const me = await call('GET', '/v1/renters/me', { session: first.json().token });
    expect(me.json()).toMatchObject({ email, verified: true });

    const second = await call('POST', '/v1/renters/verify', { body: { token } });
    expect(second.statusCode).toBe(400);
    expect(second.json().error.code).toBe('invalid_token');
  });

  it('expires the link after 30 minutes, and a new one can be asked for', async () => {
    const email = address();
    await call('POST', '/v1/renters', { body: { email, name: 'Pat', password: PASSWORD } });
    const token = linkToken(email);
    t.now.value = new Date(NOW.getTime() + 31 * 60_000);
    try {
      expect((await call('POST', '/v1/renters/verify', { body: { token } })).statusCode).toBe(400);
      const resend = await call('POST', '/v1/renters/verification', { body: { email } });
      expect(resend.statusCode).toBe(202);
      const fresh = linkToken(email);
      expect(fresh).not.toBe(token);
      expect(
        (await call('POST', '/v1/renters/verify', { body: { token: fresh } })).statusCode,
      ).toBe(200);
    } finally {
      t.now.value = NOW;
    }
  });

  it('answers a request for a new link alike whether or not the address has an account', async () => {
    const unknown = await call('POST', '/v1/renters/verification', {
      body: { email: 'nobody@example.org' },
    });
    expect(unknown.statusCode).toBe(202);
    expect(mailTo('nobody@example.org')).toEqual([]);
  });
});

describe('signing in', () => {
  it('refuses a wrong password and an unconfirmed address, and lets a confirmed renter in', async () => {
    const email = address();
    await call('POST', '/v1/renters', { body: { email, name: 'Pat', password: PASSWORD } });
    const unconfirmed = await call('POST', '/v1/renters/sessions', {
      body: { email, password: PASSWORD },
    });
    expect(unconfirmed.statusCode).toBe(403);
    expect(unconfirmed.json().error.code).toBe('email_not_verified');

    await call('POST', '/v1/renters/verify', { body: { token: linkToken(email) } });
    const wrong = await call('POST', '/v1/renters/sessions', {
      body: { email, password: 'not the password' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error.code).toBe('invalid_credentials');
    const unknown = await call('POST', '/v1/renters/sessions', {
      body: { email: 'ghost@example.org', password: PASSWORD },
    });
    expect(unknown.json()).toEqual(wrong.json()); // the same answer for an address with no account

    const right = await call('POST', '/v1/renters/sessions', {
      body: { email: email.toUpperCase(), password: PASSWORD },
    });
    expect(right.statusCode).toBe(200);
    expect(right.json().token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
  });

  it('locks an account for 15 minutes after five wrong passwords, even against the right one', async () => {
    const { email } = await confirmedRenter();
    for (let i = 0; i < 5; i++) {
      expect(
        (
          await call('POST', '/v1/renters/sessions', {
            body: { email, password: `wrong ${i} password` },
          })
        ).statusCode,
      ).toBe(401);
    }
    const locked = await call('POST', '/v1/renters/sessions', {
      body: { email, password: PASSWORD },
    });
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.code).toBe('account_locked');
    t.now.value = new Date(NOW.getTime() + 16 * 60_000);
    try {
      expect(
        (await call('POST', '/v1/renters/sessions', { body: { email, password: PASSWORD } }))
          .statusCode,
      ).toBe(200);
    } finally {
      t.now.value = NOW;
    }
  });

  it('ends a session on sign-out, and refuses a made-up session', async () => {
    const { session } = await confirmedRenter();
    expect((await call('GET', '/v1/renters/me', { session })).statusCode).toBe(200);
    expect((await call('DELETE', '/v1/renters/sessions/current', { session })).statusCode).toBe(
      204,
    );
    const after = await call('GET', '/v1/renters/me', { session });
    expect(after.statusCode).toBe(401);
    expect(after.json().error.code).toBe('invalid_session');
    expect(
      (
        await call('GET', '/v1/renters/me', {
          session: 'made-up-session-token-that-is-long-enough',
        })
      ).statusCode,
    ).toBe(401);
    expect((await call('GET', '/v1/renters/me')).statusCode).toBe(401);
  });
});

describe('a renter’s quotes', () => {
  const quoteBody = async () => ({
    activityId: await t.activityId('Yoga class'),
    participants: 20,
    hours: 2,
    alcohol: 'none',
    eventDate: '2026-12-20',
    startTime: '18:00',
    limitCents: 200_000_000,
    holder: { name: `Pat Renter ${++counter}`, email: 'pat@example.org' },
  });

  it('belong to the renter who made them while signed in, with the policy once paid for', async () => {
    const { session } = await confirmedRenter();
    const made = await call('POST', '/v1/quotes', { session, body: await quoteBody() });
    expect(made.statusCode).toBe(201);
    const bound = await call('POST', `/v1/quotes/${made.json().id}/bind`, {
      session,
      body: { paymentToken: 'tok_ok' },
    });
    expect(bound.statusCode).toBe(200);

    const mine = (await call('GET', '/v1/renters/me/quotes', { session })).json().quotes;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      id: made.json().id,
      programId: 'prg_1',
      state: 'bound',
      activityTitle: 'Yoga class',
      policy: { id: bound.json().policyId, policyNumber: bound.json().policyNumber },
    });
  });

  it('takes a quote made before signing in when the renter pays for it, and keeps it from anyone else', async () => {
    const owner = await confirmedRenter();
    const stranger = await confirmedRenter();
    const guestQuote = (await call('POST', '/v1/quotes', { body: await quoteBody() })).json();
    const paid = await call('POST', `/v1/quotes/${guestQuote.id}/bind`, {
      session: owner.session,
      body: { paymentToken: 'tok_ok' },
    });
    expect(paid.statusCode).toBe(200);
    const mine = (await call('GET', '/v1/renters/me/quotes', { session: owner.session })).json()
      .quotes;
    expect(mine.map((q: { id: string }) => q.id)).toEqual([guestQuote.id]);

    const ownersQuote = (
      await call('POST', '/v1/quotes', { session: owner.session, body: await quoteBody() })
    ).json();
    const taken = await call('POST', `/v1/quotes/${ownersQuote.id}/bind`, {
      session: stranger.session,
      body: { paymentToken: 'tok_ok' },
    });
    expect(taken.statusCode).toBe(403);
    expect(taken.json().error.code).toBe('not_your_quote');
  });
});

describe('the demo mailbox', () => {
  // A browser claims an address's mailbox before it can read it, and only the first claim wins: the demo's stand-in for
  // owning the mailbox, so typing someone else's address does not show their mail or their confirmation link.
  it('belongs to the first browser that claims the address', async () => {
    const email = address();
    await call('POST', '/v1/renters', { body: { email, name: 'Pat', password: PASSWORD } });
    const claim = await call('POST', '/v1/demo/mailboxes', {
      key: operator,
      body: { address: email },
    });
    expect(claim.statusCode).toBe(201);
    const { key } = claim.json();

    const box = await call(
      'GET',
      `/v1/demo/mailbox?to=${encodeURIComponent(email.toUpperCase())}`,
      {
        key: operator,
        headers: { 'mailbox-key': key },
      },
    );
    expect(box.statusCode).toBe(200);
    expect(box.json().messages).toHaveLength(1);
    expect(box.json().messages[0]).toMatchObject({
      to: email,
      action: { label: 'Confirm my e-mail' },
    });

    const second = await call('POST', '/v1/demo/mailboxes', {
      key: operator,
      body: { address: email.toUpperCase() },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('mailbox_taken');
  });

  it('is refused without the key, with another address’s key, and to a program’s key', async () => {
    const [mine, theirs] = [address(), address()];
    const { key } = (
      await call('POST', '/v1/demo/mailboxes', { key: operator, body: { address: mine } })
    ).json();
    const read = (to: string, headers: Record<string, string>, as = operator) =>
      call('GET', `/v1/demo/mailbox?to=${to}`, { key: as, headers });

    expect((await read(mine, {})).statusCode).toBe(403);
    expect((await read(theirs, { 'mailbox-key': key })).json().error.code).toBe('not_your_mailbox');
    expect((await read(mine, { 'mailbox-key': 'x'.repeat(43) })).statusCode).toBe(403);
    expect((await read(mine, { 'mailbox-key': key }, portal)).statusCode).toBe(403);
    expect(
      (await call('POST', '/v1/demo/mailboxes', { body: { address: address() } })).statusCode,
    ).toBe(403);
  });
});
