import { describe, expect, it } from 'vitest';
import { applyEdits, buildWorksheet, DEFAULT_FACTORS } from './index.js';

const base = 10_000; // net cents from the rate card
const plain = { dailyPeak: 100, alcohol: 'none' as const, flags: [] };
const amounts = (facts: Parameters<typeof buildWorksheet>[0]) =>
  Object.fromEntries(
    buildWorksheet(facts, DEFAULT_FACTORS, base).lines.map((l) => [l.id, l.amountCents]),
  );

describe('buildWorksheet', () => {
  it('starts from the rate card premium and charges nothing more for a plain event', () => {
    const ws = buildWorksheet(plain, DEFAULT_FACTORS, base);
    expect(ws.lines[0]).toMatchObject({ id: 'base', amountCents: 10_000 });
    expect(ws.lines.filter((l) => l.amountCents !== 0)).toHaveLength(1);
    expect(ws.netTotalCents).toBe(10_000);
  });

  it('loads by the attendance band, with the boundaries in the right place', () => {
    const at = (dailyPeak: number) => amounts({ ...plain, dailyPeak }).attendance;
    expect([300, 301, 500, 501, 1000, 1001, 3000, 3001].map(at)).toEqual([
      0, 1000, 1000, 2500, 2500, 5000, 5000, 9000,
    ]);
  });

  it('adds alcohol, hazards and minors as a share of the base', () => {
    const a = amounts({ ...plain, alcohol: 'sold', flags: ['fireworks', 'minors'] });
    expect(a.alcohol).toBe(1500);
    expect(a['flag:fireworks']).toBe(4000);
    expect(a['flag:minors']).toBe(500);
  });

  it('prices vendors by type, seats by started hundred, and a claim in the last five years', () => {
    const a = amounts({
      ...plain,
      vendors: { liquor: 2, inflatable: 1, security: 2 },
      temporarySeats: 250,
      priorClaims: true,
    });
    expect(a['vendor:liquor']).toBe(12_000);
    expect(a['vendor:inflatable']).toBe(3000);
    expect(a['vendor:security']).toBe(-8000); // a credit
    expect(a.seats).toBe(450); // three started hundreds at 1.5% of the base
    expect(a.claims).toBe(2000);
  });

  it('shows what the application did not say, at no charge, so the underwriter knows what to ask', () => {
    const ws = buildWorksheet(plain, DEFAULT_FACTORS, base);
    for (const id of ['vendors', 'seats', 'claims']) {
      expect(ws.lines.find((l) => l.id === id)).toMatchObject({
        amountCents: 0,
        basis: expect.stringMatching(/not provided/i),
      });
    }
  });

  it('asks about server training only when alcohol is served or sold', () => {
    expect(
      buildWorksheet(plain, DEFAULT_FACTORS, base).lines.some((l) => l.id === 'training'),
    ).toBe(false);
    const ws = buildWorksheet({ ...plain, alcohol: 'served' }, DEFAULT_FACTORS, base);
    expect(ws.lines.find((l) => l.id === 'training')?.basis).toMatch(/not provided/i);
    const without = buildWorksheet(
      { ...plain, alcohol: 'served', serverTraining: false },
      DEFAULT_FACTORS,
      base,
    );
    expect(without.lines.find((l) => l.id === 'training')?.amountCents).toBe(800);
  });

  it('states a basis and a whole-cent amount on every line, and the lines add up', () => {
    const ws = buildWorksheet(
      {
        dailyPeak: 777,
        alcohol: 'sold',
        flags: ['animals', 'overnight'],
        vendors: { food: 3, carnival: 2 },
        temporarySeats: 90,
        priorClaims: false,
        serverTraining: true,
      },
      DEFAULT_FACTORS,
      12_345,
    );
    for (const line of ws.lines) {
      expect(line.basis.length, line.id).toBeGreaterThan(5);
      expect(Number.isInteger(line.amountCents), line.id).toBe(true);
    }
    expect(ws.netTotalCents).toBe(ws.lines.reduce((sum, l) => sum + l.amountCents, 0));
  });
});

describe('applyEdits', () => {
  const ws = buildWorksheet({ ...plain, alcohol: 'sold' }, DEFAULT_FACTORS, base);

  it('keeps the original amount of an edited line and re-adds the total', () => {
    const edited = applyEdits(ws, [
      { id: 'alcohol', amountCents: 500, note: 'cash bar closes early' },
    ]);
    const line = edited.lines.find((l) => l.id === 'alcohol');
    expect(line).toMatchObject({
      amountCents: 500,
      editedFromCents: 1500,
      note: 'cash bar closes early',
    });
    expect(edited.netTotalCents).toBe(ws.netTotalCents - 1000);
    expect(ws.lines.find((l) => l.id === 'alcohol')?.amountCents).toBe(1500); // the original is untouched
  });

  it('does not mark a line as edited when the amount is unchanged', () => {
    const edited = applyEdits(ws, [{ id: 'alcohol', amountCents: 1500, note: 'agreed' }]);
    expect(edited.lines.find((l) => l.id === 'alcohol')?.editedFromCents).toBeUndefined();
  });

  it('rejects an unknown line, the rate card line and a total that is not positive', () => {
    expect(() => applyEdits(ws, [{ id: 'nope', amountCents: 1, note: 'x' }])).toThrow(
      /unknown line/,
    );
    expect(() => applyEdits(ws, [{ id: 'base', amountCents: 1, note: 'x' }])).toThrow(/rate card/);
    expect(() => applyEdits(ws, [{ id: 'alcohol', amountCents: -20_000, note: 'x' }])).toThrow(
      /positive/,
    );
  });
});
