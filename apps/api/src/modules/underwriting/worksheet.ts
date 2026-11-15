import type { AlcoholMode, Cents, EventFlag } from '../../domain/types.js';
import type { FactorTable, VendorType } from './factors.js';

// What an application says about a large event. Anything left out (undefined or null) shows on the worksheet as
// "not provided" at no charge, so the underwriter sees what still has to be asked.
export interface WorksheetFacts {
  dailyPeak: number | null;
  alcohol: AlcoholMode | null;
  flags: EventFlag[];
  serverTraining?: boolean | null;
  vendors?: Partial<Record<VendorType, number>>;
  temporarySeats?: number | null;
  priorClaims?: boolean | null;
}

export interface WorksheetLine {
  id: string;
  factor: string;
  /** Why this line, and how the amount was worked out, in words. */
  basis: string;
  amountCents: Cents;
  /** Set when an underwriter changed the amount: what the worksheet proposed. */
  editedFromCents?: Cents;
  note?: string;
}

export interface Worksheet {
  lines: WorksheetLine[];
  netTotalCents: Cents;
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const percent = (bps: number) => `${bps / 100}%`;
const NOT_PROVIDED = 'not provided: ask the applicant';

const total = (lines: WorksheetLine[]) => lines.reduce((sum, l) => sum + l.amountCents, 0);

// Pure. Starts from the rate card's net premium and adds one line per risk factor. Amounts are whole cents.
export function buildWorksheet(
  facts: WorksheetFacts,
  table: FactorTable,
  baseNetCents: Cents,
): Worksheet {
  const share = (bps: number) => Math.round((baseNetCents * bps) / 10_000);
  const lines: WorksheetLine[] = [
    {
      id: 'base',
      factor: 'Rate card premium',
      basis: `net premium from the rate card: ${money(baseNetCents)}`,
      amountCents: baseNetCents,
    },
  ];
  const add = (id: string, factor: string, basis: string, amountCents: Cents) =>
    lines.push({ id, factor, basis, amountCents });

  if (facts.dailyPeak === null) {
    add('attendance', 'Attendance', NOT_PROVIDED, 0);
  } else {
    const band = table.attendance.find(
      (b) => facts.dailyPeak !== null && facts.dailyPeak <= b.upTo,
    );
    const bps = band?.bps ?? 0;
    add(
      'attendance',
      'Attendance',
      `largest daily crowd ${facts.dailyPeak}: ${percent(bps)} of the rate card premium`,
      share(bps),
    );
  }

  if (facts.alcohol === null) {
    add('alcohol', 'Alcohol', NOT_PROVIDED, 0);
  } else {
    add(
      'alcohol',
      'Alcohol',
      `alcohol ${facts.alcohol}: ${percent(table.alcohol[facts.alcohol])} of the rate card premium`,
      share(table.alcohol[facts.alcohol]),
    );
    if (facts.alcohol !== 'none') {
      if (facts.serverTraining === undefined || facts.serverTraining === null) {
        add('training', 'Server training', NOT_PROVIDED, 0);
      } else if (facts.serverTraining) {
        add('training', 'Server training', 'all servers are trained: no charge', 0);
      } else {
        add(
          'training',
          'Server training',
          `servers are not all trained: ${percent(table.untrainedServersBps)} of the rate card premium`,
          share(table.untrainedServersBps),
        );
      }
    }
  }

  for (const flag of facts.flags) {
    add(
      `flag:${flag}`,
      `Hazard: ${flag}`,
      `the description mentions ${flag}: ${percent(table.flags[flag])} of the rate card premium`,
      share(table.flags[flag]),
    );
  }

  const vendors =
    facts.vendors && Object.entries(facts.vendors).filter(([, count]) => (count ?? 0) > 0);
  if (!facts.vendors) {
    add('vendors', 'Vendors', NOT_PROVIDED, 0);
  } else {
    for (const [type, count] of vendors ?? []) {
      const each = table.vendorCents[type as VendorType];
      add(
        `vendor:${type}`,
        `Vendors: ${type}`,
        `${count} x ${money(each)}${each < 0 ? ' (a credit)' : ''}`,
        (count ?? 0) * each,
      );
    }
  }

  if (facts.temporarySeats === undefined || facts.temporarySeats === null) {
    add('seats', 'Temporary seating', NOT_PROVIDED, 0);
  } else {
    const hundreds = Math.ceil(facts.temporarySeats / 100);
    add(
      'seats',
      'Temporary seating',
      `${facts.temporarySeats} seats: ${hundreds} started hundred(s) at ${percent(table.seatsBpsPerStartedHundred)} each`,
      hundreds * share(table.seatsBpsPerStartedHundred),
    );
  }

  if (facts.priorClaims === undefined || facts.priorClaims === null) {
    add('claims', 'Claims history', NOT_PROVIDED, 0);
  } else if (facts.priorClaims) {
    add(
      'claims',
      'Claims history',
      `a claim in the last five years: ${percent(table.priorClaimBps)} of the rate card premium`,
      share(table.priorClaimBps),
    );
  } else {
    add('claims', 'Claims history', 'no claims in the last five years: no charge', 0);
  }

  return { lines, netTotalCents: total(lines) };
}

export interface LineEdit {
  id: string;
  amountCents: Cents;
  note: string;
}

// Returns a copy with the edits applied. An edited line keeps the amount the worksheet proposed, so the decision
// shows both. The rate card line is not editable: change the class or the activity with an override instead.
export function applyEdits(worksheet: Worksheet, edits: LineEdit[]): Worksheet {
  const lines = worksheet.lines.map((line) => ({ ...line }));
  for (const edit of edits) {
    const line = lines.find((l) => l.id === edit.id);
    if (!line) throw new Error(`unknown line ${edit.id}`);
    if (line.id === 'base') throw new Error('the rate card line cannot be edited');
    if (edit.amountCents === line.amountCents) continue;
    line.editedFromCents ??= line.amountCents;
    line.amountCents = edit.amountCents;
    line.note = edit.note;
  }
  const netTotalCents = total(lines);
  if (netTotalCents <= 0) throw new Error('the net premium must stay positive');
  return { lines, netTotalCents };
}
