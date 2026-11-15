import 'server-only';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { ApiError, api } from './api';

// A client console is opened by a link the operator hands out. The browser keeps the link's secret in an HttpOnly cookie
// for that console's path only; every visit asks the API again, so a revoked link stops at once.
export const consoleCookie = (code: string) => `venue_client_${code.toUpperCase()}`;

export interface ClientAccess {
  accessId: string;
  programId: string;
  code: string;
  label: string;
}

export async function resolveLink(token: string): Promise<ClientAccess | null> {
  try {
    return await api<ClientAccess>('operator', '/v1/access/resolve', {
      method: 'POST',
      body: { token },
    });
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 400)) return null;
    throw error;
  }
}

/** The program this browser's link opens, when it still does and is for this code. */
export const clientOf = cache(async (code: string): Promise<ClientAccess | null> => {
  const token = (await cookies()).get(consoleCookie(code))?.value;
  if (!token) return null;
  const access = await resolveLink(token);
  return access && access.code.toLowerCase() === code.toLowerCase() ? access : null;
});
