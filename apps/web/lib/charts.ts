// Small pure helpers behind the charts, so they can be tested without a browser.

// How many policies were issued on each day of a month (YYYY-MM): one entry per day, zero where nothing was.
export function bucketByDay(issuedOn: string[], month: string): { day: number; count: number }[] {
  const [year, mon] = month.split('-').map(Number) as [number, number];
  const days = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const counts = new Array<number>(days).fill(0);
  for (const date of issuedOn) {
    if (!date.startsWith(month)) continue;
    const day = Number(date.slice(8, 10));
    if (day >= 1 && day <= days) counts[day - 1] = (counts[day - 1] ?? 0) + 1;
  }
  return counts.map((count, i) => ({ day: i + 1, count }));
}

// Shares of a total, in order, that add up to exactly 100 (the largest remainder takes the rounding), for labels.
export function shares(parts: number[]): number[] {
  const total = parts.reduce((a, b) => a + b, 0);
  if (total === 0) return parts.map(() => 0);
  const raw = parts.map((p) => (p / total) * 100);
  const floors = raw.map(Math.floor);
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, rest: r - Math.floor(r) })).sort((a, b) => b.rest - a.rest);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] = (floors[i] ?? 0) + 1;
    left -= 1;
  }
  return floors;
}
