import { describe, expect, it } from 'vitest';
import { isPrivateAddress, nextAttemptAt, sign, verify } from './index.js';

const secret = 'whsec_test';
const body = '{"id":"e1","type":"policy.issued"}';

describe('sign and verify', () => {
  it('round trips', () => {
    const header = sign(secret, 1_700_000_000, body);
    expect(header).toMatch(/^t=1700000000,v1=[0-9a-f]{64}$/);
    expect(verify(secret, header, body, 1_700_000_000, 300)).toBe(true);
  });

  it('rejects a changed body, a wrong secret and a malformed header', () => {
    const header = sign(secret, 1_700_000_000, body);
    expect(verify(secret, header, `${body} `, 1_700_000_000, 300)).toBe(false);
    expect(verify('whsec_other', header, body, 1_700_000_000, 300)).toBe(false);
    for (const bad of [
      '',
      'v1=abc',
      't=1700000000',
      't=abc,v1=00',
      `t=1700000000,v1=${'0'.repeat(64)}`,
    ]) {
      expect(verify(secret, bad, body, 1_700_000_000, 300)).toBe(false);
    }
  });

  it('rejects a stale or future timestamp', () => {
    const header = sign(secret, 1_700_000_000, body);
    expect(verify(secret, header, body, 1_700_000_300, 300)).toBe(true);
    expect(verify(secret, header, body, 1_700_000_301, 300)).toBe(false);
    expect(verify(secret, header, body, 1_699_999_699, 300)).toBe(false);
  });
});

describe('nextAttemptAt', () => {
  const now = new Date('2026-11-13T12:00:00Z');
  const delaySec = (attempt: number, rand: number) => {
    const next = nextAttemptAt(attempt, now, () => rand);
    return next === null ? null : (next.getTime() - now.getTime()) / 1000;
  };

  it('doubles from 30 seconds', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => delaySec(n, 1))).toEqual([
      30, 60, 120, 240, 480, 960, 1920,
    ]);
  });

  it('applies jitter between half and the full delay', () => {
    expect(delaySec(3, 0)).toBe(60);
    expect(delaySec(3, 0.5)).toBe(90);
  });

  it('gives up after the eighth attempt', () => {
    expect(nextAttemptAt(8, now, () => 1)).toBeNull();
    expect(nextAttemptAt(9, now, () => 1)).toBeNull();
  });
});

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '0.0.0.0',
    '100.64.0.1',
    '::1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    '::ffff:127.0.0.1',
  ])('treats %s as private', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '203.0.113.9', '2606:4700::1111'])(
    'treats %s as public',
    (ip) => {
      expect(isPrivateAddress(ip)).toBe(false);
    },
  );
});
