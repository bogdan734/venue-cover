import { describe, expect, it } from 'vitest';
import { bps, day, limit, limitShort, money, percent, relative, stamp } from './format';

describe('format', () => {
  it('writes money and limits the Canadian way', () => {
    expect(money(123456)).toBe('$1,234.56');
    expect(money(0)).toBe('$0.00');
    expect(money(5)).toBe('$0.05');
    expect(limit(200_000_000)).toBe('$2,000,000');
    expect(limitShort(500_000_000)).toBe('$5M');
    expect(limitShort(250_000_000)).toBe('$2,500,000');
  });

  it('writes shares and basis points as percentages', () => {
    expect(percent(0.876)).toBe('87.6%');
    expect(percent(1, 0)).toBe('100%');
    expect(percent(null)).toBe('n/a');
    expect(bps(1500)).toBe('15%');
    expect(bps(1250)).toBe('12.5%');
  });

  it('writes a day without moving it across a time zone, and a moment in UTC', () => {
    expect(day('2026-12-20')).toBe('Dec 20, 2026');
    expect(day('2026-12-20T23:30:00.000Z')).toBe('Dec 20, 2026');
    expect(stamp('2026-11-14T01:05:00.000Z')).toBe('Nov 14, 2026, 01:05 UTC');
  });

  it('says how long ago or how far ahead', () => {
    const now = new Date('2026-11-14T12:00:00Z');
    expect(relative('2026-11-14T11:59:30Z', now)).toBe('30 seconds ago');
    expect(relative('2026-11-14T11:15:00Z', now)).toBe('45 minutes ago');
    expect(relative('2026-11-14T15:00:00Z', now)).toBe('in 3 hours');
    expect(relative('2026-11-12T12:00:00Z', now)).toBe('2 days ago');
  });
});
