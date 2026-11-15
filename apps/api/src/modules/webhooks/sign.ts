import { createHmac, timingSafeEqual } from 'node:crypto';

// Header value: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`. Signing the timestamp too lets a receiver
// reject replays of an old, valid request.
export function sign(secret: string, timestamp: number, body: string): string {
  const mac = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${mac}`;
}

export function verify(
  secret: string,
  header: string,
  body: string,
  nowSeconds: number,
  toleranceSeconds: number,
): boolean {
  const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header);
  if (!match) return false;
  const timestamp = Number(match[1]);
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;
  const expected = Buffer.from(sign(secret, timestamp, body).slice(-64), 'hex');
  const given = Buffer.from(match[2] as string, 'hex');
  return expected.length === given.length && timingSafeEqual(expected, given);
}
