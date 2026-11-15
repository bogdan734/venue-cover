'use server';

import { createHash, timingSafeEqual } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { FormState } from '@/components/use-server-form';
import { COOKIE, SESSION_SECONDS } from '@/lib/auth';
import { createLimiter, visitorOf } from '@/lib/rate-limit';
import { authMode, issueToken, safeNext, secretOf } from '@/lib/session';

// Five wrong passwords in fifteen minutes lock a visitor out for the rest of the window.
const attempts = createLimiter({ limit: 5, windowMs: 15 * 60_000 });

const digest = (text: string) => createHash('sha256').update(text).digest();

export async function login(_: FormState, form: FormData): Promise<FormState> {
  const mode = authMode({
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
    NODE_ENV: process.env.NODE_ENV,
  });
  if (mode === 'open') redirect('/');
  if (mode === 'locked')
    return { error: 'The admin console is closed: no password has been set on this server.' };

  const requestHeaders = await headers();
  if (!attempts.allow(visitorOf(requestHeaders)))
    return { error: 'Too many attempts. Try again in a few minutes.' };

  const given = String(form.get('password') ?? '');
  const right = timingSafeEqual(digest(given), digest(process.env.ADMIN_PASSWORD as string));
  if (!right) return { error: 'That password is not right.' };

  const token = await issueToken(
    secretOf(process.env.ADMIN_PASSWORD as string),
    SESSION_SECONDS,
    Math.floor(Date.now() / 1000),
  );
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: requestHeaders.get('x-forwarded-proto') === 'https',
    path: '/',
    maxAge: SESSION_SECONDS,
  });
  redirect(safeNext(String(form.get('next') ?? '/')));
}

export async function logout(): Promise<void> {
  (await cookies()).delete(COOKIE);
  redirect('/login');
}
