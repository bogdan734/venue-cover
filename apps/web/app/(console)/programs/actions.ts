'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormState } from '@/components/use-server-form';
import { ApiError, api } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import type { ProgramDetail, RulesChanges, RulesDraft, RulesPreview, Theme } from '@/lib/types';

const text = (form: FormData, name: string): string => String(form.get(name) ?? '').trim();

export interface LinkState {
  error?: string;
  token?: string;
  label?: string;
}

export async function createProgram(_: FormState, form: FormData): Promise<FormState> {
  await requireAdmin();
  let created: ProgramDetail;
  try {
    created = await api<ProgramDetail>('operator', '/v1/programs', {
      method: 'POST',
      idempotencyKey: text(form, 'idem'),
      body: {
        templateId: text(form, 'templateId'),
        name: text(form, 'name'),
        code: text(form, 'code').toUpperCase(),
        province: text(form, 'province'),
        brokerId: text(form, 'brokerId'),
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    throw error;
  }
  revalidatePath('/', 'layout');
  redirect(`/programs/${created.id}`);
}

// Reads a client's letter into proposed changes. Nothing is published by this.
export async function draft(
  programId: string,
  letter: string,
): Promise<RulesDraft | { error: string }> {
  await requireAdmin();
  try {
    const drafted = await api<RulesDraft>('operator', `/v1/programs/${programId}/rules/draft`, {
      method: 'POST',
      body: { text: letter },
    });
    const ids = drafted.changes.excludedActivityIds ?? [];
    const { titles } = ids.length
      ? await api<{ titles: Record<string, string> }>(
          'operator',
          `/v1/activity-titles?ids=${ids.join(',')}`,
        )
      : { titles: {} };
    return { ...drafted, titles };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    throw error;
  }
}

export async function preview(
  programId: string,
  changes: RulesChanges,
): Promise<RulesPreview | { error: string }> {
  await requireAdmin();
  try {
    return await api<RulesPreview>('operator', `/v1/programs/${programId}/rules/preview`, {
      method: 'POST',
      body: { changes, sample: 100 },
    });
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    throw error;
  }
}

export async function publish(
  programId: string,
  changes: RulesChanges,
  effectiveFrom: string,
  idem: string,
): Promise<{ version: number; effectiveFrom: string } | { error: string }> {
  await requireAdmin();
  try {
    const published = await api<{ version: number; effectiveFrom: string }>(
      'operator',
      `/v1/programs/${programId}/rules`,
      { method: 'POST', idempotencyKey: idem, body: { changes, effectiveFrom } },
    );
    revalidatePath('/programs', 'layout');
    return published;
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    throw error;
  }
}

// Appearance and contacts are replaced whole; the API refuses a colour that cannot be read.
export async function saveAppearance(programId: string, theme: Theme): Promise<FormState> {
  await requireAdmin();
  try {
    await api('operator', `/v1/programs/${programId}/appearance`, { method: 'PUT', body: theme });
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    throw error;
  }
  revalidatePath('/', 'layout');
  return { done: 'Saved. The portal shows it now.' };
}

const optional = (form: FormData, name: string): string | null => text(form, name) || null;

export async function saveContacts(
  programId: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await requireAdmin();
  const telegram = optional(form, 'telegram');
  try {
    await api('operator', `/v1/programs/${programId}/contacts`, {
      method: 'PUT',
      body: {
        supportEmail: optional(form, 'supportEmail'),
        supportPhone: optional(form, 'supportPhone'),
        telegram: telegram && !telegram.startsWith('@') ? `@${telegram}` : telegram,
        hours: optional(form, 'hours'),
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    throw error;
  }
  revalidatePath('/', 'layout');
  return { done: 'Saved. Renters see these at the foot of every portal page.' };
}

export async function moveProgram(programId: string, form: FormData): Promise<void> {
  await requireAdmin();
  await api('operator', `/v1/programs/${programId}/status`, {
    method: 'POST',
    idempotencyKey: text(form, 'idem'),
    body: { to: text(form, 'to') },
  });
  revalidatePath('/', 'layout');
}

// A link that opens this program's client console. Its secret is shown once, here, and never again.
export async function createClientLink(
  programId: string,
  _: LinkState,
  form: FormData,
): Promise<LinkState> {
  await requireAdmin();
  try {
    const made = await api<{ token: string; label: string }>(
      'operator',
      `/v1/programs/${programId}/access`,
      {
        method: 'POST',
        idempotencyKey: text(form, 'idem'),
        body: { label: text(form, 'label') },
      },
    );
    revalidatePath(`/programs/${programId}`);
    return { token: made.token, label: made.label };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    throw error;
  }
}

export async function revokeClientLink(programId: string, accessId: string): Promise<void> {
  await requireAdmin();
  await api('operator', `/v1/programs/${programId}/access/${accessId}/revoke`, {
    method: 'POST',
    idempotencyKey: `revoke-${accessId}`,
  });
  revalidatePath(`/programs/${programId}`);
}
