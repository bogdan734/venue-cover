import { describe, expect, it } from 'vitest';
import { createRng } from '../../../../../data/prng.js';
import type { PremiumBreakdown, ProgramTerms } from '../../domain/types.js';
import type { PolicyView } from '../policies/index.js';
import { breakdownFromNet } from '../rating/index.js';
import { csvCell, policyReportCsv } from './csv.js';
import { buildPolicyReport, monthRange } from './policy-report.js';

const TERMS: ProgramTerms = { loadingBps: 4500, commissionBps: 1500, feeCents: 350 };
const premiumFor = (netCents: number): PremiumBreakdown =>
  breakdownFromNet(netCents, TERMS, 'ON', 'rate_1');

let counter = 0;
function policy(
  over: {
    programId?: string;
    net?: number;
    issuedAt?: string;
    limitCents?: number;
    venue?: string | null;
    bookingRef?: string | null;
    activity?: string;
  } = {},
): PolicyView {
  counter += 1;
  const premium = premiumFor(over.net ?? 10_000 + counter * 137);
  return {
    id: `pol_${counter}`,
    programId: over.programId ?? 'prg_a',
    quoteId: `qte_${counter}`,
    policyNumber: `AAA-${String(counter).padStart(6, '0')}`,
    startsAt: '2026-12-20T23:00:00.000Z',
    endsAt: '2026-12-21T03:00:00.000Z',
    totalCents: premium.totalCents,
    issuedAt: over.issuedAt ?? '2026-11-10T15:00:00.000Z',
    snapshot: {
      holder: { name: 'Pat Example', email: 'pat@example.org' },
      programName: 'Program A',
      activityTitle: over.activity ?? 'Yoga class',
      venue: over.venue === null ? null : { id: 'ven_1', name: over.venue ?? 'Town Hall' },
      bookingRef: over.bookingRef === undefined ? 'BK-1' : over.bookingRef,
      limitCents: over.limitCents ?? 200_000_000,
      participants: 20,
      hours: 2,
      alcohol: 'none',
      premium,
      recipients: { venue: null, broker: null },
      routed: false,
    },
  };
}

describe('monthRange', () => {
  it('is half-open in UTC and rolls over the year', () => {
    expect(monthRange('2026-02')).toEqual({
      from: new Date('2026-02-01T00:00:00.000Z'),
      to: new Date('2026-03-01T00:00:00.000Z'),
    });
    expect(monthRange('2026-12').to).toEqual(new Date('2027-01-01T00:00:00.000Z'));
  });

  it.each(['2026-13', '2026-00', '2026-1', 'Nov 2026', '2026-11-01', ''])('refuses %j', (bad) => {
    expect(() => monthRange(bad)).toThrow(RangeError);
  });
});

describe('the policy report', () => {
  const random = createRng(5);
  const many = Array.from({ length: 30 }, () =>
    policy({
      net: 1_000 + Math.floor(random() * 400_000),
      limitCents: random() < 0.5 ? 200_000_000 : 500_000_000,
    }),
  );

  it('has a summary that equals the sum of its detail lines', () => {
    const b = buildPolicyReport('2026-11', null, many);
    const sum = (pick: (l: (typeof b.lines)[number]) => number) =>
      b.lines.reduce((s, l) => s + pick(l), 0);
    const { total, byLimit } = b.summary;
    expect(total.policies).toBe(b.lines.length);
    expect(total.totalCents).toBe(sum((l) => l.totalCents));
    expect(total.netCents).toBe(sum((l) => l.netCents));
    expect(total.commissionCents).toBe(sum((l) => l.commissionCents));
    expect(total.taxCents).toBe(sum((l) => l.taxCents));
    expect(total.feeCents).toBe(sum((l) => l.feeCents));
    expect(total.grossCents).toBe(sum((l) => l.netCents + l.commissionCents + l.marginCents));
    expect(byLimit.map((r) => r.limitCents)).toEqual([200_000_000, 500_000_000]);
    for (const field of [
      'policies',
      'grossCents',
      'taxCents',
      'commissionCents',
      'netCents',
    ] as const) {
      expect(byLimit.reduce((s, r) => s + r[field], 0)).toBe(total[field]);
    }
    expect(total.grossCents + total.feeCents + total.taxCents).toBe(total.totalCents);
  });

  it('lists policies in the order they were issued, with the facts a carrier asks for', () => {
    const early = policy({
      issuedAt: '2026-11-02T09:00:00.000Z',
      venue: null,
      bookingRef: null,
      activity: 'Birthday party',
    });
    const late = policy({ issuedAt: '2026-11-20T09:00:00.000Z' });
    const b = buildPolicyReport('2026-11', { id: 'prg_a', code: 'AAA', name: 'Program A' }, [
      late,
      early,
    ]);
    expect(b.lines.map((l) => l.policyNumber)).toEqual([early.policyNumber, late.policyNumber]);
    expect(b.lines[0]).toMatchObject({
      program: 'Program A',
      issuedOn: '2026-11-02',
      eventDate: '2026-12-20',
      venue: '',
      bookingRef: '',
      activity: 'Birthday party',
      participants: 20,
      hours: 2,
    });
    expect(b.program).toEqual({ id: 'prg_a', code: 'AAA', name: 'Program A' });
  });

  it('is empty, not broken, for a month with no policies', () => {
    const b = buildPolicyReport('2026-01', null, []);
    expect(b.lines).toEqual([]);
    expect(b.summary.byLimit).toEqual([]);
    expect(b.summary.total).toMatchObject({ policies: 0, totalCents: 0, grossCents: 0 });
  });
});

describe('csv', () => {
  it('quotes a cell that holds a comma, a quote or a line break', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('Smith, Jo')).toBe('"Smith, Jo"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
  });

  it('turns text a spreadsheet would run as a formula into plain text, and leaves numbers alone', () => {
    for (const text of ['=SUM(A1)', '+1+1', '-2+3', '@cmd', '\tx']) {
      expect(csvCell(text).startsWith("'")).toBe(true);
    }
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(12.5)).toBe('12.5');
  });

  it('writes a header and one row per policy, in dollars, with CRLF line ends', () => {
    const p = policy({ net: 10_000, activity: '=HYPERLINK("http://x")' });
    const csv = policyReportCsv(buildPolicyReport('2026-11', null, [p]));
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(3); // header, one policy, and the empty string after the last line end
    expect(lines[0]?.startsWith('Policy,Program,Issued,Event date')).toBe(true);
    expect(lines[1]).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(lines[1]).toContain((p.totalCents / 100).toFixed(2));
    expect(lines[2]).toBe('');
  });
});
