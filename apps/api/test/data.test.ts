import { describe, expect, it } from 'vitest';
import { generate } from '../../../data/generate.js';

describe('synthetic data', () => {
  it('same seed gives identical data', () => {
    expect(generate(7)).toEqual(generate(7));
  });

  it('another seed changes the rates and the sanctions list', () => {
    const a = generate(1);
    const b = generate(2);
    expect(a.rateRows).not.toEqual(b.rateRows);
    expect(a.sanctions).not.toEqual(b.sanctions);
  });

  it('every activity has a product and a risk class', () => {
    const data = generate(1);
    const productIds = new Set(data.products.map((p) => p.id));
    expect(data.activities.length).toBeGreaterThan(200);
    for (const activity of data.activities) {
      expect(productIds.has(activity.productId)).toBe(true);
      expect(['A', 'B', 'C', 'X']).toContain(activity.riskClass);
    }
  });

  it('keeps ids unique and offers every risk class', () => {
    const data = generate(1);
    const ids = data.activities.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    const classes = new Set(data.activities.map((a) => a.riskClass));
    expect([...classes].sort()).toEqual(['A', 'B', 'C', 'X']);
  });

  it('prices every product in two versions and never prices an excluded class', () => {
    const data = generate(1);
    for (const product of data.products) {
      const versions = new Set(
        data.rateRows.filter((r) => r.productId === product.id).map((r) => r.effectiveFrom),
      );
      expect([...versions].sort()).toEqual(['2025-03-01', '2026-03-01']);
    }
    expect(data.rateRows.every((r) => r.riskClass !== ('X' as string))).toBe(true);
  });
});
