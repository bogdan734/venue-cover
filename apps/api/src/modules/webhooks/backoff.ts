export const MAX_DELIVERY_ATTEMPTS = 8;

const BASE_SECONDS = 30;
const CAP_SECONDS = 3600;

// `attempt` is how many attempts have failed so far. The delay doubles from 30 seconds up to an hour, with jitter
// between half and all of it so that endpoints that fail together do not all retry together. After the eighth
// failed attempt there is no next one.
export function nextAttemptAt(attempt: number, now: Date, rand: () => number): Date | null {
  if (attempt >= MAX_DELIVERY_ATTEMPTS) return null;
  const nominal = Math.min(BASE_SECONDS * 2 ** (attempt - 1), CAP_SECONDS);
  return new Date(now.getTime() + nominal * (0.5 + 0.5 * rand()) * 1000);
}
