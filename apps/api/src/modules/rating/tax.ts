import type { ProvinceCode } from '../../domain/types.js';

// Provincial sales tax on insurance premiums, in basis points. Illustrative figures for the demo, not tax advice.
const PREMIUM_TAX_BPS: Record<ProvinceCode, number> = {
  AB: 0,
  BC: 0,
  MB: 700,
  NB: 0,
  NL: 1500,
  NS: 0,
  NT: 0,
  NU: 0,
  ON: 800,
  PE: 0,
  QC: 900,
  SK: 600,
  YT: 0,
};

export function premiumTaxBps(province: ProvinceCode): number {
  return PREMIUM_TAX_BPS[province];
}
