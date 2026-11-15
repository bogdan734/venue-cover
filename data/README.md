# Synthetic data

Everything here is invented for this project. Nothing comes from a third-party file: no figures, codes, lists or screenshots.
`generate(seed)` is deterministic; the same seed returns identical data.

- **Catalogue** (`catalogue.ts`): 233 activities (80 class A, 85 B, 51 C, 17 X) over 8 coverage products, each with a risk class (A low, B medium, C high,
  X excluded) and a few aliases. Written from general knowledge of how venues and events are insured.
- **Rates**: one row per product, class, limit, alcohol mode and participant band, in two versions
  (effective 2025-03-01 and 2026-03-01; the older one is 4% cheaper).
  `net cents per hour = round(product base x class x limit x alcohol x band)`, with
  - product base 600 to 2,600 cents an hour, jittered by 5% from the seed;
  - class A 1.0, B 1.6, C 2.6; limit 2M 1.0, 5M 1.45; alcohol none 1.0, served 1.35, sold 1.7;
  - participant bands 1-25, 26-50 (1.0), 51-75 (1.9), 76-100 (2.3), 101-150 (3.1), 151-200 (3.9), 201-300 (5.2), 301-500 (7.5).
  Above 500 participants there is no rate on purpose: such events go to a human.
- **Programs**: three invented programs (an Ontario municipality, an Alberta school board, a Quebec hall network) with their own
  loading, commission, policy fee and automatic-decision thresholds.
- **Sanctions list**: 40 invented company names; they are not real entities.

All prices are hourly in this demo, including leagues and instructors, which real programs often price differently.
