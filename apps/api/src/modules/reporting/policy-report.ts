import type { Cents, PremiumBreakdown } from '../../domain/types.js';
import type { PolicyView } from '../policies/index.js';

// What the risk costs before the policy fee and the tax.
const grossOf = (p: PremiumBreakdown): Cents => p.netCents + p.commissionCents + p.marginCents;

export interface PolicyLine {
  policyNumber: string;
  program: string;
  issuedOn: string;
  eventDate: string;
  venue: string;
  bookingRef: string;
  activity: string;
  participants: number;
  hours: number;
  limitCents: Cents;
  netCents: Cents;
  commissionCents: Cents;
  marginCents: Cents;
  feeCents: Cents;
  taxCents: Cents;
  totalCents: Cents;
}

export interface PolicyTotals {
  policies: number;
  grossCents: Cents;
  taxCents: Cents;
  commissionCents: Cents;
  netCents: Cents;
}

export interface PolicyReport {
  /** YYYY-MM, in UTC. */
  period: string;
  /** Null when the report covers every program. */
  program: { id: string; code: string; name: string } | null;
  summary: {
    byLimit: (PolicyTotals & { limitCents: Cents })[];
    total: PolicyTotals & { feeCents: Cents; totalCents: Cents };
  };
  lines: PolicyLine[];
}

// [from, to) of a month, in UTC.
export function monthRange(month: string): { from: Date; to: Date } {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) throw new RangeError(`a month is written YYYY-MM, not ${month}`);
  const year = Number(match[1]);
  const index = Number(match[2]) - 1;
  return { from: new Date(Date.UTC(year, index, 1)), to: new Date(Date.UTC(year, index + 1, 1)) };
}

const empty = (): PolicyTotals => ({
  policies: 0,
  grossCents: 0,
  taxCents: 0,
  commissionCents: 0,
  netCents: 0,
});

function add(into: PolicyTotals, policy: PolicyView): void {
  const { premium } = policy.snapshot;
  into.policies += 1;
  into.grossCents += grossOf(premium);
  into.taxCents += premium.taxCents;
  into.commissionCents += premium.commissionCents;
  into.netCents += premium.netCents;
}

// Pure. The summary is computed from the same policies as the lines and never typed in, so it cannot disagree
// with them.
export function buildPolicyReport(
  period: string,
  program: PolicyReport['program'],
  policies: PolicyView[],
): PolicyReport {
  const lines: PolicyLine[] = policies
    .toSorted(
      (a, b) =>
        a.issuedAt.localeCompare(b.issuedAt) || a.policyNumber.localeCompare(b.policyNumber),
    )
    .map(({ snapshot: s, ...p }) => ({
      policyNumber: p.policyNumber,
      program: s.programName,
      issuedOn: p.issuedAt.slice(0, 10),
      eventDate: p.startsAt.slice(0, 10),
      venue: s.venue?.name ?? '',
      bookingRef: s.bookingRef ?? '',
      activity: s.activityTitle,
      participants: s.participants,
      hours: s.hours,
      limitCents: s.limitCents,
      netCents: s.premium.netCents,
      commissionCents: s.premium.commissionCents,
      marginCents: s.premium.marginCents,
      feeCents: s.premium.feeCents,
      taxCents: s.premium.taxCents,
      totalCents: s.premium.totalCents,
    }));

  const total = { ...empty(), feeCents: 0, totalCents: 0 };
  const byLimit = new Map<Cents, PolicyTotals & { limitCents: Cents }>();
  for (const policy of policies) {
    const limit = policy.snapshot.limitCents;
    const row = byLimit.get(limit) ?? { limitCents: limit, ...empty() };
    add(row, policy);
    byLimit.set(limit, row);
    add(total, policy);
    total.feeCents += policy.snapshot.premium.feeCents;
    total.totalCents += policy.snapshot.premium.totalCents;
  }
  return {
    period,
    program,
    summary: { byLimit: [...byLimit.values()].sort((a, b) => a.limitCents - b.limitCents), total },
    lines,
  };
}
