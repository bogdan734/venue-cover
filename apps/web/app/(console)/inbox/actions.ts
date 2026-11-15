'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import type { FormState } from '@/components/use-server-form';
import { ApiError, api } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';

// A person answers: from then on the conversation is theirs and the assistant stays quiet.
export async function reply(id: string, _: FormState, form: FormData): Promise<FormState> {
  await requireAdmin();
  const text = String(form.get('text') ?? '').trim();
  if (!text) return { error: 'Write something first.' };
  try {
    await api('operator', `/v1/inbox/${id}/messages`, {
      method: 'POST',
      idempotencyKey: String(form.get('idem') ?? randomUUID()),
      body: { text },
    });
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    throw error;
  }
  revalidatePath('/inbox');
  return { done: 'Sent.' };
}

export async function moveConversation(id: string, form: FormData): Promise<void> {
  await requireAdmin();
  await api('operator', `/v1/inbox/${id}/state`, {
    method: 'POST',
    idempotencyKey: randomUUID(),
    body: { to: String(form.get('to')) },
  });
  revalidatePath('/', 'layout');
}
