import type { FastifyRequest } from 'fastify';
import type { Kysely, Selectable } from 'kysely';
import { z } from 'zod';
import type { Database } from '../../db/types.js';
import { newId } from '../../domain/ids.js';
import { HttpError } from '../../http/errors.js';
import type { MailMessage } from '../../providers/mail.js';
import { dummyHash, hashPassword, verifyPassword } from './password.js';
import { hashToken, newToken } from './tokens.js';

const CONFIRM_MS = 30 * 60_000;
const SESSION_MS = 14 * 86_400_000;
const LOCK_AFTER = 5;
const LOCK_MS = 15 * 60_000;
// A confirmation e-mail is not sent again to the same account more often than this many times in a window.
const RESENDS_PER_WINDOW = 3;

export const RegisterBody = z.object({
  email: z.email().max(320),
  name: z.string().trim().min(1).max(200),
  password: z.string().min(10, 'a password needs at least 10 characters').max(200),
});
export const SignInBody = z.object({
  email: z.email().max(320),
  password: z.string().min(1).max(200),
});
export const VerifyBody = z.object({ token: z.string().min(20).max(200) });
export const ResendBody = z.object({ email: z.email().max(320) });

export interface RenterView {
  id: string;
  email: string;
  name: string;
  verified: boolean;
  createdAt: string;
}

type RenterRow = Selectable<Database['renter']>;

const view = (row: RenterRow): RenterView => ({
  id: row.id,
  email: row.email,
  name: row.name,
  verified: row.email_verified_at !== null,
  createdAt: row.created_at.toISOString(),
});

const normalise = (email: string): string => email.trim().toLowerCase();

// Where a link in an e-mail points: the program's portal, under the web app's address when it is known.
export type LinkTo = (path: string) => string;

async function issue(
  db: Kysely<Database>,
  renterId: string,
  purpose: 'verify' | 'session',
  now: Date,
): Promise<string> {
  const token = newToken();
  await db
    .insertInto('renter_token')
    .values({
      token_hash: hashToken(token),
      renter_id: renterId,
      purpose,
      expires_at: new Date(now.getTime() + (purpose === 'verify' ? CONFIRM_MS : SESSION_MS)),
    })
    .execute();
  return token;
}

function confirmationMail(
  renter: { email: string; name: string },
  token: string,
  link: LinkTo,
): MailMessage {
  return {
    to: renter.email,
    subject: 'Confirm your e-mail',
    body: `Hello ${renter.name},\n\nConfirm this address to buy cover and to see your quotes and policies in one place. The button works once, for 30 minutes.\n\nIf you did not ask for this, ignore this message: nothing happens until the address is confirmed.`,
    action: { label: 'Confirm my e-mail', url: link(`/verify?token=${token}`) },
    idempotencyKey: `confirm:${hashToken(token)}`,
  };
}

// Sends a fresh confirmation link unless this account has had several in the last half hour, so the form cannot be used to
// flood someone's inbox. Returns the message to send, or null.
async function freshLink(
  db: Kysely<Database>,
  renter: RenterRow,
  link: LinkTo,
  now: Date,
): Promise<MailMessage | null> {
  const recent = await db
    .selectFrom('renter_token')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('renter_id', '=', renter.id)
    .where('purpose', '=', 'verify')
    .where('created_at', '>', new Date(now.getTime() - CONFIRM_MS))
    .executeTakeFirstOrThrow();
  if (Number(recent.n) >= RESENDS_PER_WINDOW) return null;
  return confirmationMail(renter, await issue(db, renter.id, 'verify', now), link);
}

// The answer does not say whether the address already had an account; only the mail to that address does. An existing
// account keeps its password and its name: registering again changes nothing.
export async function register(
  db: Kysely<Database>,
  input: z.infer<typeof RegisterBody>,
  link: LinkTo,
  now: Date,
): Promise<MailMessage | null> {
  const email = normalise(input.email);
  // Hashed whether or not it will be used, so a taken address answers as slowly as a new one.
  const passwordHash = await hashPassword(input.password);
  return db.transaction().execute(async (trx) => {
    const existing = await trx
      .selectFrom('renter')
      .selectAll()
      .where('email', '=', email)
      .forUpdate()
      .executeTakeFirst();
    if (existing?.email_verified_at) {
      return {
        to: existing.email,
        subject: 'You already have an account',
        body: `Hello ${existing.name},\n\nSomeone, probably you, tried to create an account with this address. You already have one, so sign in instead.\n\nIf it was not you, you can ignore this message: nothing has changed.`,
        action: { label: 'Sign in', url: link('/account/sign-in') },
        idempotencyKey: `taken:${existing.id}:${now.getTime()}`,
      };
    }
    if (existing) return freshLink(trx, existing, link, now);
    const id = newId('rnt');
    await trx
      .insertInto('renter')
      .values({ id, email, name: input.name, password_hash: passwordHash })
      .execute();
    return confirmationMail({ email, name: input.name }, await issue(trx, id, 'verify', now), link);
  });
}

export async function resendConfirmation(
  db: Kysely<Database>,
  email: string,
  link: LinkTo,
  now: Date,
): Promise<MailMessage | null> {
  const renter = await db
    .selectFrom('renter')
    .selectAll()
    .where('email', '=', normalise(email))
    .executeTakeFirst();
  if (!renter || renter.email_verified_at) return null;
  return freshLink(db, renter, link, now);
}

// A confirmation link is single-use and short-lived, and using it signs the person in: it proves they read the mailbox,
// which is what a password reset proves too.
export async function confirm(
  db: Kysely<Database>,
  token: string,
  now: Date,
): Promise<{ token: string; renter: RenterView }> {
  return db.transaction().execute(async (trx) => {
    const row = await trx
      .selectFrom('renter_token')
      .selectAll()
      .where('token_hash', '=', hashToken(token))
      .where('purpose', '=', 'verify')
      .forUpdate()
      .executeTakeFirst();
    if (!row || row.used_at || row.expires_at.getTime() <= now.getTime()) {
      throw new HttpError(
        400,
        'invalid_token',
        'this link has expired or was used already: ask for a new one',
      );
    }
    await trx
      .updateTable('renter_token')
      .set({ used_at: now })
      .where('token_hash', '=', row.token_hash)
      .execute();
    const renter = await trx
      .updateTable('renter')
      .set((eb) => ({ email_verified_at: eb.fn.coalesce('email_verified_at', eb.val(now)) }))
      .where('id', '=', row.renter_id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return { token: await issue(trx, renter.id, 'session', now), renter: view(renter) };
  });
}

const invalidCredentials = () =>
  new HttpError(401, 'invalid_credentials', 'the e-mail or the password is not right');

export async function signIn(
  db: Kysely<Database>,
  input: z.infer<typeof SignInBody>,
  now: Date,
): Promise<{ token: string; renter: RenterView }> {
  const renter = await db
    .selectFrom('renter')
    .selectAll()
    .where('email', '=', normalise(input.email))
    .executeTakeFirst();
  if (!renter) {
    await verifyPassword(input.password, await dummyHash());
    throw invalidCredentials();
  }
  if (renter.locked_until && renter.locked_until.getTime() > now.getTime()) {
    const minutes = Math.ceil((renter.locked_until.getTime() - now.getTime()) / 60_000);
    throw new HttpError(
      429,
      'account_locked',
      `too many wrong passwords: try again in ${minutes} minutes`,
    );
  }
  if (!(await verifyPassword(input.password, renter.password_hash))) {
    const failed = await db
      .updateTable('renter')
      .set((eb) => ({ failed_logins: eb('failed_logins', '+', 1) }))
      .where('id', '=', renter.id)
      .returning('failed_logins')
      .executeTakeFirstOrThrow();
    if (failed.failed_logins >= LOCK_AFTER) {
      await db
        .updateTable('renter')
        .set({ failed_logins: 0, locked_until: new Date(now.getTime() + LOCK_MS) })
        .where('id', '=', renter.id)
        .execute();
    }
    throw invalidCredentials();
  }
  await db
    .updateTable('renter')
    .set({ failed_logins: 0, locked_until: null })
    .where('id', '=', renter.id)
    .execute();
  if (!renter.email_verified_at) {
    throw new HttpError(
      403,
      'email_not_verified',
      'confirm your e-mail first: we can send the link again',
    );
  }
  return { token: await issue(db, renter.id, 'session', now), renter: view(renter) };
}

export async function signOut(db: Kysely<Database>, token: string, now: Date): Promise<void> {
  await db
    .updateTable('renter_token')
    .set({ used_at: now })
    .where('token_hash', '=', hashToken(token))
    .where('purpose', '=', 'session')
    .execute();
}

export const SESSION_HEADER = 'renter-session';

// The renter a request is made for: none without the header, and a refusal for a header that is not a live session.
export async function renterOf(
  db: Kysely<Database>,
  request: FastifyRequest,
  now: Date,
): Promise<RenterView | null> {
  const token = request.headers[SESSION_HEADER];
  if (token === undefined) return null;
  const row =
    typeof token === 'string'
      ? await db
          .selectFrom('renter_token')
          .innerJoin('renter', 'renter.id', 'renter_token.renter_id')
          .selectAll('renter')
          .where('renter_token.token_hash', '=', hashToken(token))
          .where('renter_token.purpose', '=', 'session')
          .where('renter_token.used_at', 'is', null)
          .where('renter_token.expires_at', '>', now)
          .executeTakeFirst()
      : undefined;
  if (!row) throw new HttpError(401, 'invalid_session', 'the session has ended: sign in again');
  return view(row);
}

export async function requireRenter(
  db: Kysely<Database>,
  request: FastifyRequest,
  now: Date,
): Promise<RenterView> {
  const renter = await renterOf(db, request, now);
  if (!renter) throw new HttpError(401, 'invalid_session', 'sign in first');
  return renter;
}
