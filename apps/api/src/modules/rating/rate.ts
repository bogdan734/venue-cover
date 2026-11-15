import type {
  AlcoholMode,
  Cents,
  PremiumBreakdown,
  PricedRiskClass,
  ProgramTerms,
  ProvinceCode,
  RiskClass,
} from '../../domain/types.js';
import { premiumTaxBps } from './tax.js';

export interface RateRow {
  id: string;
  productId: string;
  riskClass: PricedRiskClass;
  limitCents: Cents;
  alcohol: AlcoholMode;
  participantsMin: number;
  participantsMax: number;
  netCentsPerHour: number;
  effectiveFrom: string;
  /** Exclusive: the row stops applying on this date. */
  effectiveTo: string | null;
}

export interface RatingInput {
  product: { id: string; maxHours: number };
  riskClass: RiskClass;
  limitCents: Cents;
  alcohol: AlcoholMode;
  participants: number;
  hours: number;
  province: ProvinceCode;
  /** Calendar date of the event, 'YYYY-MM-DD'; selects the rate version. */
  eventDate: string;
}

export class NoRateError extends Error {
  /** True when only the participant count is the problem: the event is larger than the largest priced band. */
  constructor(
    input: RatingInput,
    readonly aboveLargestBand: boolean,
    /** The largest participant count the rate card prices for this combination, when there is one. */
    readonly largestBand: number | null = null,
  ) {
    super(
      `no rate for ${input.product.id}, class ${input.riskClass}, ${input.participants} participants, alcohol ${input.alcohol} on ${input.eventDate}`,
    );
    this.name = 'NoRateError';
  }
}

export class OverMaxHoursError extends Error {
  constructor(hours: number, maxHours: number) {
    super(`${hours} hours is above the product cap of ${maxHours}`);
    this.name = 'OverMaxHoursError';
  }
}

const BPS = 10_000;

function inForce(row: RateRow, date: string): boolean {
  // ISO dates compare correctly as strings.
  return row.effectiveFrom <= date && (row.effectiveTo === null || date < row.effectiveTo);
}

// Everything after the net premium: gross from the program loading, then commission, MGA margin, policy fee and tax.
// Commission is rounded down so that the margin can never go negative. The net can come from a rate row or, for events
// priced by an underwriter, from a worksheet.
export function breakdownFromNet(
  netCents: Cents,
  terms: ProgramTerms,
  province: ProvinceCode,
  rateRowId: string,
): PremiumBreakdown {
  const grossCents = Math.ceil((netCents * BPS) / (BPS - terms.loadingBps));
  const commissionCents = Math.floor((grossCents * terms.commissionBps) / BPS);
  const taxCents = Math.round(((grossCents + terms.feeCents) * premiumTaxBps(province)) / BPS);
  return {
    netCents,
    commissionCents,
    marginCents: grossCents - netCents - commissionCents,
    feeCents: terms.feeCents,
    taxCents,
    totalCents: grossCents + terms.feeCents + taxCents,
    rateRowId,
  };
}

// The net comes from the matching hourly rate, for the version in force on the event date.
export function rate(
  input: RatingInput,
  rows: readonly RateRow[],
  terms: ProgramTerms,
): PremiumBreakdown {
  if (!(input.hours > 0)) throw new RangeError('hours must be positive');
  if (!Number.isInteger(input.participants) || input.participants < 1) {
    throw new RangeError('participants must be a positive integer');
  }
  if (input.hours > input.product.maxHours)
    throw new OverMaxHoursError(input.hours, input.product.maxHours);

  const comparable = rows.filter(
    (r) =>
      r.productId === input.product.id &&
      r.riskClass === input.riskClass &&
      r.limitCents === input.limitCents &&
      r.alcohol === input.alcohol &&
      inForce(r, input.eventDate),
  );
  const matches = comparable.filter(
    (r) => r.participantsMin <= input.participants && input.participants <= r.participantsMax,
  );
  const [row, ...extra] = matches;
  if (!row) {
    const aboveLargestBand =
      comparable.length > 0 && comparable.every((r) => input.participants > r.participantsMax);
    const largestBand =
      comparable.length > 0 ? Math.max(...comparable.map((r) => r.participantsMax)) : null;
    throw new NoRateError(input, aboveLargestBand, largestBand);
  }
  if (extra.length > 0)
    throw new Error(`ambiguous rate rows: ${matches.map((r) => r.id).join(', ')}`);

  return breakdownFromNet(
    row.netCentsPerHour * Math.ceil(input.hours),
    terms,
    input.province,
    row.id,
  );
}
