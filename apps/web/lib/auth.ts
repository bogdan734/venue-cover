import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { authMode, secretOf, verifyToken } from './session';

export const COOKIE = 'venue_admin';
export const SESSION_SECONDS = 8 * 3600;

export async function isAdmin(): Promise<boolean> {
  const mode = authMode({
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
    NODE_ENV: process.env.NODE_ENV,
  });
  if (mode === 'open') return true;
  if (mode === 'locked') return false;
  const token = (await cookies()).get(COOKIE)?.value;
  return verifyToken(
    secretOf(process.env.ADMIN_PASSWORD as string),
    token,
    Math.floor(Date.now() / 1000),
  );
}

// The second lock. The proxy already keeps strangers away from the admin paths; every admin server action and route
// asks again, so a mistake in one place does not open the other.
export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) redirect('/login');
}
