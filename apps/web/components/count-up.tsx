'use client';

import { useLayoutEffect, useState } from 'react';
import { money } from '@/lib/format';

// What kind of number: a count, a percentage with one decimal, or an amount in cents. (A function cannot cross from a
// server page to this component, so the format is named.)
export type CountKind = 'count' | 'percent' | 'money';
const FORMATS: Record<CountKind, (value: number) => string> = {
  count: (v) => String(Math.round(v)),
  percent: (v) => `${v.toFixed(1)}%`,
  money: (v) => money(Math.round(v)),
};

// A number that counts up to its value when it first appears. The final value is always in the page for a screen reader
// (and for anything that reads the text), and with reduced motion the number is simply there.
export function CountUp({
  value,
  kind = 'count',
  ms = 900,
}: {
  value: number;
  kind?: CountKind;
  ms?: number;
}) {
  const format = FORMATS[kind];
  const [shown, setShown] = useState(value);

  // Before the first paint, so the final number never flashes before the count starts. The cleanup makes this safe to run
  // twice (as React does in development): the second run starts the count again from nothing.
  useLayoutEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      setShown(value * (1 - (1 - t) ** 3));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    setShown(0);
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, ms]);

  return (
    <>
      <span className="sr-only">{format(value)}</span>
      <span aria-hidden>{format(shown)}</span>
    </>
  );
}
