import type { AlcoholMode, EventFlag, VendorType } from '../../domain/types.js';

export type { VendorType };

// The loadings an underwriter applies to the rate card premium. Percentages are basis points of that premium, vendor
// amounts are cents each (a negative one is a credit). The default is invented; a program would hold its own.
export interface FactorTable {
  /** Loading by the largest daily crowd; `upTo` is inclusive. */
  attendance: readonly { upTo: number; bps: number }[];
  alcohol: Record<AlcoholMode, number>;
  flags: Record<EventFlag, number>;
  vendorCents: Record<VendorType, number>;
  seatsBpsPerStartedHundred: number;
  priorClaimBps: number;
  untrainedServersBps: number;
}

export const DEFAULT_FACTORS: FactorTable = {
  attendance: [
    { upTo: 300, bps: 0 },
    { upTo: 500, bps: 1000 },
    { upTo: 1000, bps: 2500 },
    { upTo: 3000, bps: 5000 },
    { upTo: Number.POSITIVE_INFINITY, bps: 9000 },
  ],
  alcohol: { none: 0, served: 500, sold: 1500 },
  flags: {
    fireworks: 4000,
    overnight: 3000,
    animals: 1500,
    inflatables: 1000,
    minors: 500,
    weapons: 4000,
    motorized: 3500,
  },
  vendorCents: {
    food: 2500,
    liquor: 6000,
    performer: 1500,
    retail: 1000,
    animal: 8000,
    carnival: 5000,
    dunk_tank: 4000,
    inflatable: 3000,
    security: -4000,
  },
  seatsBpsPerStartedHundred: 150,
  priorClaimBps: 2000,
  untrainedServersBps: 800,
};
