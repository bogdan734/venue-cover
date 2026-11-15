# 6. Recorded model answers, and a measured scale for each embedder

Status: accepted

## Context

Two things were hard to improve without making them harder to trust. First, evaluating retrieval and scoring meant calling a
model for seven minutes per run. Second, a real embedding model reads similarity on its own scale: this one scores unrelated
texts near 0.83, so with a fixed floor every phrase "matched", unknown activities were no longer detected, and a short French
idiom landed on a wrong activity with confidence.

## Decision

- A model's answers can be **recorded** and replayed, keyed by the whole request (instructions, schema and text). A changed prompt
  is a miss and never a wrong answer. Replaying reproduced a live run to the decimal, so everything after the model is tuned and
  regression-tested in seconds. The same recording lets the public demo run without a model or a key.
- Each embedder carries a **scale**: the cosine of unrelated texts (floor), of the same activity (ceiling), and the share of the
  score that comes from meaning rather than spelling. `npm run eval:calibrate` reads the spread from the recorded answers and
  sweeps the scale; a setting is *safe* when nothing unsafe is priced, every must-refer case is referred, and unknown activities
  are still named as such. 40 of the 60 settings around the chosen one were safe, and the chosen one is in the middle of them.
- Vectors record which model made them, so switching model re-embeds instead of comparing vectors of different models.

## Consequences

- Outcome accuracy went from 72.6% to 87.6% and French top-1 from 35% to 70%, with unsafe automation at 0 at every confidence
  threshold from 0.4 to 0.9.
- The scale was chosen on the same 259 cases it is reported on, so the figures are optimistic. A held-out set of real text is the
  next thing to build; the calibration command is what to rerun when the model, the prompt or the catalogue changes.

## Rejected

- **Hand-tuning weights by eye.** Not reproducible.
- **Leaving the cosine unscaled.** Cheapest, and wrong for any model whose similarities are compressed.
