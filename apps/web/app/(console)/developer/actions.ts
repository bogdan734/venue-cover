'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import type { FormState } from '@/components/use-server-form';
import { ApiError, api, apiResponse } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';

const refresh = () => revalidatePath('/developer');

export async function registerEndpoint(
  programId: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await requireAdmin();
  const events = form.getAll('events').map(String);
  try {
    const created = await api<{ secret: string }>({ program: programId }, '/v1/webhook-endpoints', {
      method: 'POST',
      body: { url: String(form.get('url') ?? '').trim(), events },
    });
    refresh();
    // The secret is shown once, here, and never again: the API keeps it only to sign deliveries.
    return { done: `Registered. The signing secret is ${created.secret}. It is not shown again.` };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    throw error;
  }
}

export async function removeEndpoint(programId: string, endpointId: string): Promise<FormState> {
  await requireAdmin();
  try {
    await api({ program: programId }, `/v1/webhook-endpoints/${endpointId}`, { method: 'DELETE' });
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    throw error;
  }
  refresh();
  return {};
}

export async function replayDelivery(programId: string, deliveryId: string): Promise<FormState> {
  await requireAdmin();
  try {
    await api({ program: programId }, `/v1/webhook-deliveries/${deliveryId}/replay`, {
      method: 'POST',
    });
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    throw error;
  }
  refresh();
  return {};
}

// Runs a query or mutation against the GraphQL endpoint as the program, and returns the raw answer.
export async function runGraphql(programId: string, query: string): Promise<string> {
  await requireAdmin();
  const response = await apiResponse({ program: programId }, '/graphql', {
    method: 'POST',
    body: { query },
    idempotencyKey: randomUUID(),
  });
  const text = await response.text();
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

// A signed test event to one endpoint, to check the receiver before real events reach it.
export async function sendTestEvent(programId: string, endpointId: string): Promise<FormState> {
  await requireAdmin();
  try {
    await api({ program: programId }, `/v1/webhook-endpoints/${endpointId}/test`, {
      method: 'POST',
      idempotencyKey: randomUUID(),
    });
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    throw error;
  }
  refresh();
  return {};
}
