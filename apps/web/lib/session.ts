// A signed, expiring session token and the choice of how the admin areas are guarded. Pure and free of Node-only
// modules, so the proxy (which runs before every request) and the server actions use the same code.

export type AuthMode = 'open' | 'password' | 'locked';

// With a password set, the admin areas ask for it. Without one they are open in development, for local use, and
// closed in production: a deployment that forgot the password must not become public.
export function authMode(env: { ADMIN_PASSWORD?: string; NODE_ENV?: string }): AuthMode {
  if (env.ADMIN_PASSWORD) return 'password';
  // Open only when it is plainly development; anything else, including a runtime that does not say, is closed.
  return env.NODE_ENV === 'development' ? 'open' : 'locked';
}

export const secretOf = (password: string): string => `venue-cover-session:${password}`;

const encoder = new TextEncoder();

async function mac(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(text));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Compares in time that depends on the length only, so a guess learns nothing from how fast it is refused.
export function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

// `<expiry in seconds>.<hmac of the expiry>`.
export async function issueToken(
  secret: string,
  ttlSeconds: number,
  nowSeconds: number,
): Promise<string> {
  const expiry = String(nowSeconds + ttlSeconds);
  return `${expiry}.${await mac(secret, expiry)}`;
}

export async function verifyToken(
  secret: string,
  token: string | undefined,
  nowSeconds: number,
): Promise<boolean> {
  const [expiry, signature, ...rest] = (token ?? '').split('.');
  if (!expiry || !signature || rest.length > 0 || !/^\d+$/.test(expiry)) return false;
  return safeEqual(signature, await mac(secret, expiry)) && Number(expiry) >= nowSeconds;
}

// Only a path on this site is a place to go after signing in; anything else (another host, a protocol) is ignored.
export function safeNext(value: string): string {
  return value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') ? value : '/';
}

// A renter is sent back only to a page of the portal they signed in on.
export function portalNext(code: string, value: string | undefined): string | null {
  if (!value) return null;
  const path = safeNext(value);
  return path === `/p/${code}` || path.startsWith(`/p/${code}/`) ? path : null;
}
