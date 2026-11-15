import { describe, expect, it } from 'vitest';
import {
  authMode,
  issueToken,
  portalNext,
  safeEqual,
  safeNext,
  secretOf,
  verifyToken,
} from './session';

const secret = secretOf('hunter2');

describe('session tokens', () => {
  it('verify until they expire, and not after', async () => {
    const token = await issueToken(secret, 3600, 1000);
    expect(await verifyToken(secret, token, 1000)).toBe(true);
    expect(await verifyToken(secret, token, 4599)).toBe(true);
    expect(await verifyToken(secret, token, 4601)).toBe(false);
  });

  it('refuse a token signed with another secret, one that was edited, and rubbish', async () => {
    const token = await issueToken(secret, 3600, 1000);
    expect(await verifyToken(secretOf('other'), token, 1000)).toBe(false);
    const [exp, mac] = token.split('.') as [string, string];
    expect(await verifyToken(secret, `${Number(exp) + 99999}.${mac}`, 1000)).toBe(false);
    expect(await verifyToken(secret, `${exp}.${mac.slice(0, -1)}0`, 1000)).toBe(false);
    for (const bad of ['', 'x', 'a.b', '.', '123.', undefined]) {
      expect(await verifyToken(secret, bad, 1000)).toBe(false);
    }
  });
});

describe('safeEqual', () => {
  it('compares strings of any length without throwing', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});

describe('authMode', () => {
  it('asks for a password when one is set, is open in development, and is locked in production without one', () => {
    expect(authMode({ ADMIN_PASSWORD: 'x', NODE_ENV: 'production' })).toBe('password');
    expect(authMode({ NODE_ENV: 'development' })).toBe('open');
    expect(authMode({ NODE_ENV: 'production' })).toBe('locked');
    expect(authMode({})).toBe('locked');
    expect(authMode({ NODE_ENV: 'test' })).toBe('locked');
    expect(authMode({ ADMIN_PASSWORD: '', NODE_ENV: 'production' })).toBe('locked');
  });
});

describe('safeNext', () => {
  it('keeps a path on this site and drops anything that leaves it', () => {
    expect(safeNext('/reports?month=2026-11')).toBe('/reports?month=2026-11');
    for (const bad of [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
      '',
    ]) {
      expect(safeNext(bad)).toBe('/');
    }
  });
});

describe('portalNext', () => {
  it('keeps a renter on the portal they signed in to', () => {
    expect(portalNext('FHV', '/p/FHV/quote/quo_1')).toBe('/p/FHV/quote/quo_1');
    expect(portalNext('FHV', '/p/FHV')).toBe('/p/FHV');
    for (const elsewhere of [
      undefined,
      '',
      '/p/OTH/quote/1',
      '/p/FHVX',
      '/underwriting',
      '//evil.example/p/FHV/',
      'https://evil.example/p/FHV/',
    ]) {
      expect(portalNext('FHV', elsewhere)).toBeNull();
    }
  });
});
