export type Sla = 'ok' | 'due_soon' | 'overdue';

const DUE_SOON_MS = 4 * 3600_000;

// The watchdog's view of a referral: it turns "due soon" four hours before the deadline and "overdue" after it.
export function slaStatus(dueAt: Date, now: Date): Sla {
  const remaining = dueAt.getTime() - now.getTime();
  if (remaining < 0) return 'overdue';
  return remaining <= DUE_SOON_MS ? 'due_soon' : 'ok';
}
