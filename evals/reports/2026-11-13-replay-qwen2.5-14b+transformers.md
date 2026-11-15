# Evaluation: replay-qwen2.5-14b+transformers, 2026-11-13

259 synthetic descriptions, judged against the reference rules (automatic up to class B, 300 people, alcohol allowed).
Intervals are 95% Wilson score intervals.

| Metric | Result |
|---|---|
| Top-1 activity accuracy | 86.6% (81.8–90.3, n=247) |
| Risk class accuracy | 93.1% (89.3–95.6, n=259) |
| Outcome accuracy (auto or refer) | 87.6% (83.1–91.1, n=259) |
| Referral recall (must-refer cases that were referred) | 100.0% (96.3–100.0, n=101) |
| Referral precision (referrals that were needed) | 75.9% (68.0–82.4, n=133) |
| Automatic rate | 48.6% (42.6–54.7, n=259) |
| **Unsafe automation** (should refer, priced automatically) | **0** |
| Latency p50 / p95 | 4 ms / 5 ms |

## By kind of case

| Kind | Cases | Top-1 | Outcome accuracy |
|---|---|---|---|
| excluded | 11 | 81.8% (52.3–94.9, n=11) | 100.0% (74.1–100.0, n=11) |
| french | 20 | 70.0% (48.1–85.5, n=20) | 60.0% (38.7–78.1, n=20) |
| injection | 20 | 70.0% (48.1–85.5, n=20) | 100.0% (83.9–100.0, n=20) |
| large | 8 | 100.0% (67.6–100.0, n=8) | 100.0% (67.6–100.0, n=8) |
| missing | 10 | 100.0% (72.2–100.0, n=10) | 100.0% (72.2–100.0, n=10) |
| multi | 10 | 90.0% (59.6–98.2, n=10) | 100.0% (72.2–100.0, n=10) |
| paraphrase | 12 | 75.0% (46.8–91.1, n=12) | 66.7% (39.1–86.2, n=12) |
| plain | 77 | 90.9% (82.4–95.5, n=77) | 87.0% (77.7–92.8, n=77) |
| risky | 53 | 84.9% (72.9–92.1, n=53) | 100.0% (93.2–100.0, n=53) |
| typo | 50 | 84.0% (71.5–91.7, n=50) | 80.0% (67.0–88.8, n=50) |
| unknown | 12 | n/a | 100.0% (75.7–100.0, n=12) |

## Needless referrals (first 15)

- g009: "Bocce tournament for 32 people, 4 hours, beer will be served" -> UNKNOWN_ACTIVITY
- g010: "Darts night for 20 people, 3 hours, beer sold at the bar" -> EXTRACTION_FAILED, LOW_CONFIDENCE
- g013: "Cornhole tournament for 60 people, 4 hours, no alcohol" -> LOW_CONFIDENCE
- g036: "Charity auction for 90 guests, 3 hours, beer sold at the bar" -> EXTRACTION_FAILED
- g039: "Karaoke night for 60 people, 4 hours, beer sold at the bar" -> EXTRACTION_FAILED
- g040: "Comedy night for 100 guests, 3 hours, beer sold at the bar" -> EXTRACTION_FAILED
- g060: "Food truck at the street fair, 200 visitors, 6 hours, no alcohol" -> LOW_CONFIDENCE, PROGRAM_RULE
- g066: "Farmers market with 25 vendors, 200 visitors, 5 hours, no alcohol" -> EXTRACTION_FAILED
- g071: "Day camp for 60 kids, 40 hours of programming, no alcohol" -> UNKNOWN_ACTIVITY
- g075: "Piano teacher with 8 students, 150 hours, no alcohol" -> UNKNOWN_ACTIVITY
- g079: "Our knitting group meets on Tuesdays, 14 people, 2 hours, no booze" -> LOW_CONFIDENCE
- g082: "Selling handmade candles and soaps at the craft fair, 150 visitors, 6 hours, no alcohol" -> UNKNOWN_ACTIVITY
- g085: "Sunday morning yoga in the park, 25 people, 1 hour, no booze" -> LOW_CONFIDENCE
- g087: "Our league plays slo-pitch on Thursdays, 90 players, 50 hours for the season, beer after the game" -> LOW_CONFIDENCE
- g172: "Réception de mariage pour 120 invités, 6 heures, alcool vendu au bar" -> EXTRACTION_FAILED
