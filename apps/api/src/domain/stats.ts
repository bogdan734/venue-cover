// Wilson score interval for a proportion: well behaved at small n and at 0 or 1, unlike the textbook normal interval.
export function wilson(successes: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = successes / n;
  const denominator = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

export interface Metric {
  /** null when there is nothing to measure (n = 0). */
  value: number | null;
  low: number;
  high: number;
  successes: number;
  n: number;
}

export function proportion(successes: number, n: number): Metric {
  const [low, high] = wilson(successes, n);
  return { value: n === 0 ? null : successes / n, low, high, successes, n };
}
