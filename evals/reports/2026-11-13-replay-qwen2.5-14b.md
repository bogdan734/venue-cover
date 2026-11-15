# Evaluation: replay-qwen2.5-14b, 2026-11-13

259 synthetic descriptions, judged against the reference rules (automatic up to class B, 300 people, alcohol allowed).
Intervals are 95% Wilson score intervals.

| Metric | Result |
|---|---|
| Top-1 activity accuracy | 83.4% (78.3–87.5, n=247) |
| Risk class accuracy | 86.9% (82.2–90.5, n=259) |
| Outcome accuracy (auto or refer) | 72.6% (66.9–77.7, n=259) |
| Referral recall (must-refer cases that were referred) | 100.0% (96.3–100.0, n=101) |
| Referral precision (referrals that were needed) | 58.7% (51.3–65.8, n=172) |
| Automatic rate | 33.6% (28.1–39.5, n=259) |
| **Unsafe automation** (should refer, priced automatically) | **0** |
| Latency p50 / p95 | 2 ms / 3 ms |

## By kind of case

| Kind | Cases | Top-1 | Outcome accuracy |
|---|---|---|---|
| excluded | 11 | 90.9% (62.3–98.4, n=11) | 100.0% (74.1–100.0, n=11) |
| french | 20 | 35.0% (18.1–56.7, n=20) | 20.0% (8.1–41.6, n=20) |
| injection | 20 | 70.0% (48.1–85.5, n=20) | 100.0% (83.9–100.0, n=20) |
| large | 8 | 100.0% (67.6–100.0, n=8) | 100.0% (67.6–100.0, n=8) |
| missing | 10 | 100.0% (72.2–100.0, n=10) | 100.0% (72.2–100.0, n=10) |
| multi | 10 | 80.0% (49.0–94.3, n=10) | 90.0% (59.6–98.2, n=10) |
| paraphrase | 12 | 66.7% (39.1–86.2, n=12) | 25.0% (8.9–53.2, n=12) |
| plain | 77 | 89.6% (80.8–94.6, n=77) | 63.6% (52.5–73.5, n=77) |
| risky | 53 | 84.9% (72.9–92.1, n=53) | 100.0% (93.2–100.0, n=53) |
| typo | 50 | 86.0% (73.8–93.0, n=50) | 66.0% (52.2–77.6, n=50) |
| unknown | 12 | n/a | 100.0% (75.7–100.0, n=12) |

## Needless referrals (first 15)

- g002: "Pilates session for 15 participants, 1 hour, no alcohol" -> LOW_CONFIDENCE
- g003: "Zumba class for 40 people, 1.5 hours, no alcohol" -> LOW_CONFIDENCE
- g008: "Pickleball social for 24 players, 2 hours, no alcohol" -> LOW_CONFIDENCE
- g009: "Bocce tournament for 32 people, 4 hours, beer will be served" -> LOW_CONFIDENCE
- g010: "Darts night for 20 people, 3 hours, beer sold at the bar" -> EXTRACTION_FAILED, LOW_CONFIDENCE, PROGRAM_RULE
- g013: "Cornhole tournament for 60 people, 4 hours, no alcohol" -> LOW_CONFIDENCE
- g025: "Book club meeting for 10 people, 2 hours, wine served" -> LOW_CONFIDENCE
- g036: "Charity auction for 90 guests, 3 hours, beer sold at the bar" -> EXTRACTION_FAILED
- g037: "Trade show for 250 visitors, 8 hours, no alcohol" -> LOW_CONFIDENCE
- g038: "Craft fair for 200 visitors, 6 hours, no alcohol" -> LOW_CONFIDENCE
- g039: "Karaoke night for 60 people, 4 hours, beer sold at the bar" -> EXTRACTION_FAILED
- g040: "Comedy night for 100 guests, 3 hours, beer sold at the bar" -> EXTRACTION_FAILED
- g041: "Casino night fundraiser for 120 guests, 4 hours, cash bar" -> LOW_CONFIDENCE
- g044: "School play for 180 people, 2 hours, no alcohol" -> LOW_CONFIDENCE
- g054: "Softball tournament for 120 players, 8 hours, no alcohol" -> LOW_CONFIDENCE
