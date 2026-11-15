import { describe, expect, it } from 'vitest';
import { createLimiter } from './rate-limit';

describe('createLimiter', () => {
  it('lets a visitor make the allowed number of requests in a window, then refuses', () => {
    const now = 0;
    const limiter = createLimiter({ limit: 3, windowMs: 1000, now: () => now });
    expect([1, 2, 3, 4].map(() => limiter.allow('a'))).toEqual([true, true, true, false]);
  });

  it('counts each visitor on their own', () => {
    const limiter = createLimiter({ limit: 1, windowMs: 1000, now: () => 0 });
    expect(limiter.allow('a')).toBe(true);
    expect(limiter.allow('b')).toBe(true);
    expect(limiter.allow('a')).toBe(false);
  });

  it('lets a visitor back in once the window has passed', () => {
    let now = 0;
    const limiter = createLimiter({ limit: 1, windowMs: 1000, now: () => now });
    expect(limiter.allow('a')).toBe(true);
    now = 999;
    expect(limiter.allow('a')).toBe(false);
    now = 1001;
    expect(limiter.allow('a')).toBe(true);
  });

  it('forgets visitors that have gone quiet, so the table cannot grow without end', () => {
    let now = 0;
    const limiter = createLimiter({ limit: 5, windowMs: 1000, now: () => now });
    for (let i = 0; i < 100; i++) limiter.allow(`visitor-${i}`);
    now = 5000;
    limiter.allow('someone-new');
    expect(limiter.size()).toBe(1);
  });
});

describe('createSlots', () => {
  it('lets a visitor hold a few long connections and everyone together a few more, and frees a slot when one closes', async () => {
    const { createSlots } = await import('./rate-limit');
    const slots = createSlots({ perKey: 2, total: 3 });
    const a1 = slots.acquire('a');
    const a2 = slots.acquire('a');
    expect(a1 && a2).toBeTruthy();
    expect(slots.acquire('a')).toBeNull(); // a third for the same visitor
    const b1 = slots.acquire('b');
    expect(b1).toBeTruthy();
    expect(slots.acquire('c')).toBeNull(); // the total is used up
    a1?.();
    a1?.(); // releasing twice frees only one
    expect(slots.acquire('c')).toBeTruthy();
    expect(slots.acquire('c')).toBeNull();
  });
});
