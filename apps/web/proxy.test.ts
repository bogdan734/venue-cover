import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The proxy reads its limits when it loads, so each case loads a fresh copy with the environment it needs.
async function load(env: Record<string, string>) {
  vi.resetModules();
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('ADMIN_PASSWORD', 'a password');
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  return (await import('./proxy')).proxy;
}
afterEach(() => {
  vi.unstubAllEnvs();
});

const request = (path: string, init: { method?: string; visitor?: string } = {}) =>
  new NextRequest(`http://localhost${path}`, {
    method: init.method ?? 'GET',
    headers: { 'cf-connecting-ip': init.visitor ?? '203.0.113.1' },
  });

const scriptSrc = (policy: string | null) =>
  (policy ?? '')
    .split(';')
    .map((directive) => directive.trim())
    .find((directive) => directive.startsWith('script-src')) ?? '';

describe('the proxy', () => {
  it('gives every page a fresh script nonce and lets no other inline script run', async () => {
    const proxy = await load({});
    const first = await proxy(request('/p/FHV'));
    const second = await proxy(request('/p/FHV'));
    const policy = first.headers.get('content-security-policy');
    const src = scriptSrc(policy);
    expect(src).toMatch(/'nonce-[A-Za-z0-9+/=]{16,}'/);
    expect(src).toContain("'strict-dynamic'");
    expect(src).not.toContain('unsafe-inline');
    expect(src).not.toContain('unsafe-eval');
    expect(scriptSrc(second.headers.get('content-security-policy'))).not.toBe(src);
    // Next takes the nonce from the policy on the request, so the page it renders carries the same one.
    expect(first.headers.get('x-middleware-request-content-security-policy')).toBe(policy);
  });

  it('lets Telegram frame the portals, as a Mini App, and nothing frame the back office', async () => {
    const proxy = await load({});
    const policyOf = async (path: string) => {
      const response = await proxy(request(path));
      const policy = response.headers.get('content-security-policy') ?? '';
      return {
        ancestors: policy
          .split(';')
          .map((d) => d.trim())
          .find((d) => d.startsWith('frame-ancestors')),
        frameOptions: response.headers.get('x-frame-options'),
      };
    };
    for (const path of ['/p/FHV', '/p/FHV/quote/q_1', '/portals']) {
      expect(await policyOf(path)).toEqual({
        ancestors: "frame-ancestors 'self' https://web.telegram.org",
        frameOptions: null,
      });
    }
    for (const path of ['/login', '/programs', '/c/FHV']) {
      expect(await policyOf(path)).toEqual({
        ancestors: "frame-ancestors 'none'",
        frameOptions: 'DENY',
      });
    }
  });

  it('limits attempts to sign in or to register, per visitor', async () => {
    const proxy = await load({ AUTH_ATTEMPTS_PER_15_MIN: '3' });
    const post = (path: string, visitor?: string) =>
      proxy(request(path, { method: 'POST', visitor })).then((response) => response.status);
    for (let i = 0; i < 3; i++) expect(await post('/p/FHV/account/sign-in')).toBe(200);
    expect(await post('/p/FHV/account/register')).toBe(429);
    expect(await post('/login')).toBe(429);
    expect(await post('/p/FHV/account/sign-in', '203.0.113.2')).toBe(200);
    // Opening the page is not an attempt.
    expect((await proxy(request('/p/FHV/account/sign-in'))).status).toBe(200);
  });

  it('limits reading pages too, at ten times the rate of changes', async () => {
    const proxy = await load({ RATE_LIMIT_PER_MINUTE: '2' });
    for (let i = 0; i < 20; i++) expect((await proxy(request('/portals'))).status).toBe(200);
    expect((await proxy(request('/portals'))).status).toBe(429);
    expect((await proxy(request('/portals', { visitor: '203.0.113.9' }))).status).toBe(200);
  });
});
