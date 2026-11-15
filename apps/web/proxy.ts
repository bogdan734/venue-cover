import { type NextRequest, NextResponse } from 'next/server';
import { createLimiter, visitorOf } from './lib/rate-limit';
import { authMode, secretOf, verifyToken } from './lib/session';

// In front of every request: the admin areas need the password, every visitor is limited (changes, sign-in attempts and,
// more loosely, reads), and every answer carries the security headers. What a renter uses (/p, /portals, /login) needs no
// password.
const perMinute = Number(process.env.RATE_LIMIT_PER_MINUTE ?? 60);
const writes = createLimiter({ limit: perMinute, windowMs: 60_000 });
const reads = createLimiter({ limit: perMinute * 10, windowMs: 60_000 });
const attempts = createLimiter({
  limit: Number(process.env.AUTH_ATTEMPTS_PER_15_MIN ?? 10),
  windowMs: 15 * 60_000,
});

// A client console (/c) is opened by its own link, checked on every visit, not by the staff password.
// The embed button's script and its sample page are for anyone.
const PUBLIC = [
  /^\/p\//,
  /^\/portals(\/|$)/,
  /^\/login$/,
  /^\/api\/portal\//,
  /^\/c\//,
  /^\/embed\//,
];
// Loaded by a <script> on another site, so it must not be locked to this origin.
const EMBED_SCRIPT = /^\/embed\/[A-Za-z0-9]{3,6}\.js$/;
// The portals open inside Telegram as a Mini App; Telegram on the web shows one in a frame. Nothing else may be framed.
const TELEGRAM_FRAMED = [/^\/p\//, /^\/portals(\/|$)/];
// Where a password is tried or an account is made: the admin sign-in, and a portal's sign-in and registration.
const AUTH = [/^\/login$/, /^\/p\/[^/]+\/account\/(sign-in|register)$/];
const COOKIE = 'venue_admin';

// A fresh nonce per response: only the scripts Next renders with it run, with what they load ('strict-dynamic'), so a
// script that got into the page some other way does not. Inline style attributes stay allowed: the charts set widths and
// delays that way, and a style cannot run code. Development also needs eval for React's error overlay.
function policyFor(nonce: string, https: boolean, framable: boolean): string {
  const dev = process.env.NODE_ENV === 'development';
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    framable ? "frame-ancestors 'self' https://web.telegram.org" : "frame-ancestors 'none'",
    ...(https ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

function secure(response: NextResponse, https: boolean, policy: string): NextResponse {
  response.headers.set('content-security-policy', policy);
  response.headers.set('x-content-type-options', 'nosniff');
  // The old header cannot name Telegram; where the policy allows it, the policy alone decides.
  if (policy.includes("frame-ancestors 'none'")) response.headers.set('x-frame-options', 'DENY');
  response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'permissions-policy',
    'camera=(), microphone=(), geolocation=(), payment=()',
  );
  response.headers.set('cross-origin-opener-policy', 'same-origin');
  response.headers.set('cross-origin-resource-policy', 'same-origin');
  if (https) response.headers.set('strict-transport-security', 'max-age=31536000');
  return response;
}

const tooMany = (text: string, seconds: number) =>
  new NextResponse(text, { status: 429, headers: { 'retry-after': String(seconds) } });

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const https = request.headers.get('x-forwarded-proto') === 'https';
  const policy = policyFor(
    btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18)))),
    https,
    TELEGRAM_FRAMED.some((pattern) => pattern.test(pathname)),
  );
  const visitor = visitorOf(request.headers);

  const reading = request.method === 'GET' || request.method === 'HEAD';
  if (!(reading ? reads : writes).allow(visitor)) {
    return secure(tooMany('Too many requests: slow down for a minute.', 60), https, policy);
  }
  if (request.method === 'POST' && AUTH.some((pattern) => pattern.test(pathname))) {
    if (!attempts.allow(visitor)) {
      return secure(
        tooMany('Too many attempts: try again in a quarter of an hour.', 900),
        https,
        policy,
      );
    }
  }

  const mode = authMode({
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
    NODE_ENV: process.env.NODE_ENV,
  });
  if (mode !== 'open' && !PUBLIC.some((pattern) => pattern.test(pathname))) {
    const signedIn =
      mode === 'password' &&
      (await verifyToken(
        secretOf(process.env.ADMIN_PASSWORD as string),
        request.cookies.get(COOKIE)?.value,
        Math.floor(Date.now() / 1000),
      ));
    if (!signedIn) {
      if (request.method === 'GET' && !pathname.startsWith('/api/')) {
        const to = new URL('/login', request.url);
        if (pathname !== '/') to.searchParams.set('next', pathname + request.nextUrl.search);
        return secure(NextResponse.redirect(to), https, policy);
      }
      return secure(new NextResponse('Sign in first.', { status: 401 }), https, policy);
    }
  }
  // Next reads the nonce from the policy on the request and puts it on the scripts it renders.
  const headers = new Headers(request.headers);
  headers.set('content-security-policy', policy);
  const response = secure(NextResponse.next({ request: { headers } }), https, policy);
  if (EMBED_SCRIPT.test(pathname))
    response.headers.set('cross-origin-resource-policy', 'cross-origin');
  return response;
}

export const config = {
  // Not the build output or the icon: nothing there is private, and they should be cacheable.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
