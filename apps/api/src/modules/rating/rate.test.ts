import { describe, expect, it } from 'vitest';
import { createRng } from '../../../../../data/prng.js';
import { PROVINCES, type ProgramTerms } from '../../domain/types.js';
import {
  breakdownFromNet,
  NoRateError,
  OverMaxHoursError,
  type RateRow,
  type RatingInput,
  rate,
} from './index.js';

const terms: ProgramTerms = { loadingBps: 4500, commissionBps: 1500, feeCents: 350 };
const product = { id: 'prd_room', maxHours: 120 };

function row(overrides: Partial<RateRow> = {}): RateRow {
  return {
    id: 'rate_1',
    productId: 'prd_room',
    riskClass: 'B',
    limitCents: 200_000_000,
    alcohol: 'none',
    participantsMin: 1,
    participantsMax: 50,
    netCentsPerHour: 200,
    effectiveFrom: '2026-03-01',
    effectiveTo: null,
    ...overrides,
  };
}

function input(overrides: Partial<RatingInput> = {}): RatingInput {
  return {
    product,
    riskClass: 'B',
    limitCents: 200_000_000,
    alcohol: 'none',
    participants: 40,
    hours: 4,
    province: 'ON',
    eventDate: '2026-06-01',
    ...overrides,
  };
}

describe('rate', () => {
  it('prices by hourly rate and participant band', () => {
    const rows = [
      row(),
      row({ id: 'rate_2', participantsMin: 51, participantsMax: 100, netCentsPerHour: 380 }),
    ];
    expect(rate(input({ participants: 40 }), rows, terms).netCents).toBe(800);
    expect(rate(input({ participants: 51 }), rows, terms).netCents).toBe(1520);
    expect(rate(input({ participants: 51 }), rows, terms).rateRowId).toBe('rate_2');
  });

  it('bills a started hour as a whole hour', () => {
    expect(rate(input({ hours: 1.2 }), [row()], terms).netCents).toBe(400);
  });

  it('builds gross from net, then commission, margin, fee and tax', () => {
    // net 800 -> gross ceil(800 / 0.55) = 1455; commission floor(1455 * 0.15) = 218;
    // margin 1455 - 800 - 218 = 437; tax round((1455 + 350) * 0.08) = 144; total 1455 + 350 + 144 = 1949.
    expect(rate(input(), [row()], terms)).toEqual({
      netCents: 800,
      commissionCents: 218,
      marginCents: 437,
      feeCents: 350,
      taxCents: 144,
      totalCents: 1949,
      rateRowId: 'rate_1',
    });
  });

  it('builds the same breakdown from a net premium that was set by hand', () => {
    expect(breakdownFromNet(800, terms, 'ON', 'rate_1')).toEqual(rate(input(), [row()], terms));
    expect(breakdownFromNet(5000, terms, 'ON', 'worksheet')).toMatchObject({
      netCents: 5000,
      rateRowId: 'worksheet',
    });
  });

  it('applies the provincial premium tax', () => {
    const on = rate(input({ province: 'ON' }), [row()], terms);
    const ab = rate(input({ province: 'AB' }), [row()], terms);
    expect(ab.taxCents).toBe(0);
    expect(on.taxCents).toBeGreaterThan(0);
    expect(on.totalCents - ab.totalCents).toBe(on.taxCents);
  });

  it('components sum to total for 1,000 random inputs', () => {
    const rng = createRng(99);
    const pick = <T>(list: readonly T[]) => list[Math.floor(rng() * list.length)] as T;
    for (let i = 0; i < 1000; i++) {
      const loadingBps = Math.floor(rng() * 6000);
      const randomTerms: ProgramTerms = {
        loadingBps,
        commissionBps: Math.floor(rng() * (loadingBps + 1)),
        feeCents: Math.floor(rng() * 800),
      };
      const randomRow = row({ netCentsPerHour: 1 + Math.floor(rng() * 5000) });
      const result = rate(
        input({ hours: 1 + Math.floor(rng() * 120), province: pick(PROVINCES) }),
        [randomRow],
        randomTerms,
      );
      const { netCents, commissionCents, marginCents, feeCents, taxCents, totalCents } = result;
      expect(netCents + commissionCents + marginCents + feeCents + taxCents).toBe(totalCents);
      for (const part of [netCents, commissionCents, marginCents, feeCents, taxCents]) {
        expect(part).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('throws NoRateError when no row matches', () => {
    const rows = [row()];
    expect(() => rate(input({ riskClass: 'X' }), rows, terms)).toThrow(NoRateError);
    expect(() => rate(input({ participants: 51 }), rows, terms)).toThrow(NoRateError);
    expect(() => rate(input({ alcohol: 'sold' }), rows, terms)).toThrow(NoRateError);
    expect(() => rate(input({ limitCents: 500_000_000 }), rows, terms)).toThrow(NoRateError);
    expect(() => rate(input({ product: { id: 'prd_other', maxHours: 120 } }), rows, terms)).toThrow(
      NoRateError,
    );
  });

  it('tells an event above the largest band apart from a missing combination', () => {
    const catches = (over: Partial<RatingInput>) => {
      try {
        rate(input(over), [row()], terms);
      } catch (error) {
        return (error as NoRateError).aboveLargestBand;
      }
      throw new Error('expected NoRateError');
    };
    expect(catches({ participants: 51 })).toBe(true);
    expect(catches({ alcohol: 'sold' })).toBe(false);
    expect(catches({ riskClass: 'X' })).toBe(false);
  });

  it('throws OverMaxHoursError above the product cap', () => {
    expect(() => rate(input({ hours: 121 }), [row()], terms)).toThrow(OverMaxHoursError);
    expect(rate(input({ hours: 120 }), [row()], terms).netCents).toBe(24000);
  });

  it('rejects hours or participants that are not positive', () => {
    expect(() => rate(input({ hours: 0 }), [row()], terms)).toThrow(RangeError);
    expect(() => rate(input({ participants: 0 }), [row()], terms)).toThrow(RangeError);
  });

  it('uses the rate version in force on the event date', () => {
    const rows = [
      row({
        id: 'old',
        netCentsPerHour: 190,
        effectiveFrom: '2025-03-01',
        effectiveTo: '2026-03-01',
      }),
      row({ id: 'new', netCentsPerHour: 200, effectiveFrom: '2026-03-01', effectiveTo: null }),
    ];
    expect(rate(input({ eventDate: '2026-02-28' }), rows, terms).rateRowId).toBe('old');
    expect(rate(input({ eventDate: '2026-03-01' }), rows, terms).rateRowId).toBe('new');
    expect(() => rate(input({ eventDate: '2025-02-28' }), rows, terms)).toThrow(NoRateError);
  });

  it('refuses ambiguous rows instead of picking one', () => {
    expect(() => rate(input(), [row(), row({ id: 'rate_dup' })], terms)).toThrow(/ambiguous/);
  });
});
