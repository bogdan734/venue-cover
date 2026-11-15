'use server';

import { revalidatePath } from 'next/cache';
import type { FormState } from '@/components/use-server-form';
import { ApiError, api } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';

const text = (form: FormData, name: string): string => String(form.get(name) ?? '').trim();

function refusal(error: unknown): FormState {
  if (error instanceof ApiError) return { error: error.message };
  throw error;
}

// The queue, the referral page and the count in the sidebar all change when a referral does.
const changed = () => revalidatePath('/', 'layout');

export async function take(referralId: string): Promise<FormState> {
  await requireAdmin();
  try {
    await api('operator', `/v1/referrals/${referralId}/claim`, { method: 'POST' });
  } catch (error) {
    return refusal(error);
  }
  changed();
  return {};
}

// A worksheet line is changed by typing a new amount (in dollars) beside it; a changed line needs its reason.
function editedLines(form: FormData): { id: string; amountCents: number; note: string }[] {
  const lines = [];
  for (const [name, value] of form.entries()) {
    if (!name.startsWith('line:') || typeof value !== 'string' || value.trim() === '') continue;
    const id = name.slice('line:'.length);
    lines.push({
      id,
      amountCents: Math.round(Number(value) * 100),
      note: text(form, `why:${id}`),
    });
  }
  return lines;
}

export async function decide(referralId: string, _: FormState, form: FormData): Promise<FormState> {
  await requireAdmin();
  const action = text(form, 'action');
  const lines = action === 'approve' ? editedLines(form) : [];
  if (lines.some((line) => line.note === '')) {
    return { error: 'Say why next to every amount you changed.' };
  }
  try {
    await api('operator', `/v1/referrals/${referralId}/decision`, {
      method: 'POST',
      idempotencyKey: text(form, 'idem'),
      body: {
        action,
        note: text(form, 'note'),
        ...(action === 'approve_with_override' ? { riskClass: text(form, 'riskClass') } : {}),
        ...(lines.length > 0 ? { lines } : {}),
      },
    });
  } catch (error) {
    return refusal(error);
  }
  changed();
  return { done: 'Decided.' };
}
