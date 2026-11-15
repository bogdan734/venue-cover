// A sliding-window limit per visitor, in memory. Enough for one process in front of a public demo: it keeps a visitor
// who loops a form from filling the database, and costs nothing when nobody does.
export function createLimiter(options: { limit: number; windowMs: number; now?: () => number }) {
  const now = options.now ?? Date.now;
  const hits = new Map<string, number[]>();
  return {
    allow(key: string): boolean {
      const at = now();
      const recent = (hits.get(key) ?? []).filter((t) => at - t < options.windowMs);
      if (recent.length >= options.limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(at);
      hits.set(key, recent);
      // Drop everyone whose last request is older than the window.
      for (const [other, times] of hits) {
        if (at - (times.at(-1) ?? 0) >= options.windowMs) hits.delete(other);
      }
      return true;
    },
    size: () => hits.size,
  };
}

// A cap on long-lived connections (the event stream polls the database for each one): a few per visitor and a few in
// all. `acquire` returns the function that gives the slot back, or null when there is none.
export function createSlots(options: { perKey: number; total: number }) {
  const held = new Map<string, number>();
  let all = 0;
  return {
    acquire(key: string): (() => void) | null {
      if (all >= options.total || (held.get(key) ?? 0) >= options.perKey) return null;
      held.set(key, (held.get(key) ?? 0) + 1);
      all += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        all -= 1;
        const left = (held.get(key) ?? 1) - 1;
        if (left <= 0) held.delete(key);
        else held.set(key, left);
      };
    },
  };
}

// Who is asking: the address Cloudflare saw, else the first proxy's, else this machine. The web app listens on 127.0.0.1
// only, so the headers come from the tunnel and not from the visitor.
export function visitorOf(headers: Headers): string {
  return (
    headers.get('cf-connecting-ip') ??
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'local'
  );
}
