'use server';

import { redirect } from 'next/navigation';
import type { FormState } from '@/components/use-server-form';
import { ApiError, api } from '@/lib/api';
import { portalOf } from '@/lib/portal';
import { currentRenter, sessionHeader } from '@/lib/renter';
import type { AlcoholMode, Classified, Questions, Quote } from '@/lib/types';

// A refusal by the API is something to show next to the form; anything else is a fault and goes to the error page.
function refusal(error: unknown): FormState {
  if (error instanceof ApiError) return { error: error.message };
  throw error;
}

const text = (form: FormData, name: string): string => String(form.get(name) ?? '').trim();

export async function describe(code: string, _: FormState, form: FormData): Promise<FormState> {
  const { as } = await portalOf(code);
  const description = text(form, 'text');
  if (description.length < 3) return { error: 'Tell us a little about the event first.' };
  let id: string;
  try {
    const classified = await api<Classified>(as, '/v1/intake/classify', {
      method: 'POST',
      body: { text: description },
    });
    id = classified.id;
  } catch (error) {
    return refusal(error);
  }
  redirect(`/p/${code}/event/${id}`);
}

export interface Confirmed {
  activityId?: string;
  participants?: number;
  hours?: number;
  alcohol?: AlcoholMode;
}

// The program's questions for the event as the customer has it now. Called as they change the details.
export async function questionsFor(
  code: string,
  classificationId: string,
  confirmed: Confirmed,
): Promise<Questions> {
  const { as } = await portalOf(code);
  return api<Questions>(as, '/v1/intake/questions', {
    method: 'POST',
    body: { classificationId, confirmed },
  });
}

// Answers arrive as form fields named q:<type>:<id>, so each can be read back as the type the question asks for.
function answersOf(form: FormData): Record<string, string | number | boolean> {
  const answers: Record<string, string | number | boolean> = {};
  for (const [name, value] of form.entries()) {
    const [prefix, type, id] = name.split(':');
    if (prefix !== 'q' || !id || typeof value !== 'string' || value === '') continue;
    answers[id] = type === 'yesno' ? value === 'yes' : type === 'number' ? Number(value) : value;
  }
  return answers;
}

export async function requestQuote(
  code: string,
  classificationId: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const { as } = await portalOf(code);
  const bookingRef = text(form, 'bookingRef');
  let quote: Quote;
  try {
    quote = await api<Quote>(as, '/v1/quotes', {
      method: 'POST',
      idempotencyKey: text(form, 'idem'),
      // Signed in, the quote is the renter's and shows in their account.
      headers: await sessionHeader(),
      body: {
        classificationId,
        activityId: text(form, 'activityId'),
        participants: Number(text(form, 'participants')),
        hours: Number(text(form, 'hours')),
        alcohol: text(form, 'alcohol'),
        eventDate: text(form, 'eventDate'),
        startTime: text(form, 'startTime'),
        limitCents: Number(text(form, 'limitCents')),
        holder: { name: text(form, 'holderName'), email: text(form, 'holderEmail') },
        ...(bookingRef ? { bookingRef } : {}),
        answers: answersOf(form),
      },
    });
  } catch (error) {
    return refusal(error);
  }
  redirect(`/p/${code}/quote/${quote.id}`);
}

export async function pay(
  code: string,
  quoteId: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const { as } = await portalOf(code);
  // The portal sells only to a confirmed account, so the policy and its certificates go to an address someone reads.
  // The page shows the sign-in instead of the card; this is the check behind it.
  if (!(await currentRenter(as)))
    return { error: 'Sign in to an account with a confirmed e-mail to pay.' };
  const paymentToken = text(form, 'card');
  let policyId: string;
  try {
    const bound = await api<{ policyId: string }>(as, `/v1/quotes/${quoteId}/bind`, {
      method: 'POST',
      // The same card pressed twice is one payment; another card is another attempt.
      idempotencyKey: `${text(form, 'idem')}:${paymentToken}`,
      headers: await sessionHeader(),
      body: { paymentToken },
    });
    policyId = bound.policyId;
  } catch (error) {
    if (error instanceof ApiError && error.code === 'payment_declined') {
      return { error: 'The card was declined. Nothing was charged; you can try another card.' };
    }
    return refusal(error);
  }
  redirect(`/p/${code}/policy/${policyId}`);
}

export async function reportLoss(
  code: string,
  policyId: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const { as } = await portalOf(code);
  try {
    const { claimId } = await api<{ claimId: string }>(as, '/v1/claims', {
      method: 'POST',
      idempotencyKey: text(form, 'idem'),
      body: {
        policyId,
        lossDate: text(form, 'lossDate'),
        description: text(form, 'description'),
        reporter: { name: text(form, 'reporterName'), email: text(form, 'reporterEmail') },
      },
    });
    return { done: `Your notice was recorded as ${claimId}. An adjuster will be in touch.` };
  } catch (error) {
    return refusal(error);
  }
}
