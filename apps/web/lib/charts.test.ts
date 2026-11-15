import { describe, expect, it } from 'vitest';
import { bucketByDay, shares } from './charts';

describe('bucketByDay', () => {
  it('has one entry per day of the month and counts what was issued on each', () => {
    const days = bucketByDay(['2026-11-03', '2026-11-03', '2026-11-30', '2026-10-31'], '2026-11');
    expect(days).toHaveLength(30);
    expect(days[2]).toEqual({ day: 3, count: 2 });
    expect(days[29]).toEqual({ day: 30, count: 1 });
    expect(days.reduce((sum, d) => sum + d.count, 0)).toBe(3); // another month's policy is not counted
  });

  it('knows how long February is', () => {
    expect(bucketByDay([], '2028-02')).toHaveLength(29);
    expect(bucketByDay([], '2027-02')).toHaveLength(28);
  });
});

describe('shares', () => {
  it('adds up to exactly 100 whatever the rounding', () => {
    expect(shares([1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(100);
    expect(shares([333, 333, 334]).reduce((a, b) => a + b, 0)).toBe(100);
    expect(shares([2, 3, 5])).toEqual([20, 30, 50]);
  });

  it('is all zeros for nothing', () => {
    expect(shares([0, 0])).toEqual([0, 0]);
  });
});
