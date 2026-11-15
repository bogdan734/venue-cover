'use server';

import { redirect } from 'next/navigation';
import type { FormState } from '@/components/use-server-form';
import { ApiError, api } from '@/lib/api';
import { portalOf } from '@/lib/portal';
import {
  claimInbox,
  dropSession,
  keepSession,
  rememberReturn,
  sessionHeader,
  takeReturn,
} from '@/lib/renter';
import { portalNext } from '@/lib/session';

const text = (form: FormData, name: string): string => String(form.get(name) ?? '').trim();

function refusal(error: unknown): FormState {
  if (error instanceof ApiError) return { error: error.message };
  throw error;
}

export async function register(code: string, _: FormState, form: FormData): Promise<FormState> {
  const { as } = await portalOf(code);
  const email = text(form, 'email');
  try {
    await api(as, '/v1/renters', {
      method: 'POST',
      body: { name: text(form, 'name'), email, password: String(form.get('password') ?? '') },
    });
  } catch (error) {
    return refusal(error);
  }
  // No e-mail leaves the demo: the inbox on this site shows what would have arrived.
  await claimInbox(email);
  await rememberReturn(portalNext(code, text(form, 'next')));
  redirect(`/p/${code}/inbox`);
}

export async function signIn(code: string, _: FormState, form: FormData): Promise<FormState> {
  const { as } = await portalOf(code);
  const email = text(form, 'email');
  let token: string;
  try {
    ({ token } = await api<{ token: string }>(as, '/v1/renters/sessions', {
      method: 'POST',
      body: { email, password: String(form.get('password') ?? '') },
    }));
  } catch (error) {
    // Said only after the password was right, so it tells nothing to someone guessing.
    if (error instanceof ApiError && error.code === 'email_not_verified') {
      await claimInbox(email);
      return { error: 'Confirm your e-mail first: the link is in the demo inbox.' };
    }
    return refusal(error);
  }
  await keepSession(token);
  redirect(portalNext(code, text(form, 'next')) ?? `/p/${code}/account`);
}

export async function signOut(code: string): Promise<void> {
  const { as } = await portalOf(code);
  const session = await sessionHeader();
  if (session['renter-session']) {
    try {
      await api(as, '/v1/renters/sessions/current', { method: 'DELETE', headers: session });
    } catch (error) {
      // A session that already ended is as signed out as it gets.
      if (!(error instanceof ApiError && error.status === 401)) throw error;
    }
  }
  await dropSession();
  redirect(`/p/${code}`);
}

// The link in the mail opens a page with this button rather than confirming on sight, so a mail scanner that follows
// links cannot use the link up before the person does.
export async function confirmEmail(code: string, _: FormState, form: FormData): Promise<FormState> {
  const { as } = await portalOf(code);
  let session: string;
  try {
    ({ token: session } = await api<{ token: string }>(as, '/v1/renters/verify', {
      method: 'POST',
      body: { token: text(form, 'token') },
    }));
  } catch (error) {
    return refusal(error);
  }
  await keepSession(session);
  redirect(portalNext(code, await takeReturn()) ?? `/p/${code}/account?welcome=1`);
}

export async function resend(code: string, _: FormState, form: FormData): Promise<FormState> {
  const { as } = await portalOf(code);
  const email = text(form, 'email');
  try {
    await api(as, '/v1/renters/verification', { method: 'POST', body: { email } });
  } catch (error) {
    return refusal(error);
  }
  await claimInbox(email);
  return {
    done: 'If that address has an account waiting to be confirmed, a new link is in the demo inbox.',
  };
}
