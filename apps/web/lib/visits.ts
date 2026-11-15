import { createHmac } from 'node:crypto';

// A portal counts each visitor once a day without keeping who they were: the Idempotency-Key it sends is a keyed hash
// of the address and the browser, so the API can tell a repeat but nobody can read an address back out of it.
export function visitKey(secret: string, visitor: string, programId: string, day: string): string {
  const mac = createHmac('sha256', secret).update(`${programId}\n${day}\n${visitor}`).digest('hex');
  return `visit:${day}:${mac.slice(0, 32)}`;
}

// Crawlers and link previews are not visitors.
export const isBot = (userAgent: string | null): boolean =>
  !userAgent || /bot|crawl|spider|slurp|preview|facebookexternalhit|curl|wget/i.test(userAgent);
