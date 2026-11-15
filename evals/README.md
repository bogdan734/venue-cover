# Evaluation

How often the automation is right, measured on descriptions whose answers are known, and how much of what a person wrote
reaches a model. Everything is invented for this project.

## The golden set

[`golden.ts`](golden.ts) holds 261 descriptions, each with the activity that should price it, its risk class and whether the
reference rules should price it unseen or refer it to a person. They are tagged by what makes them hard: typos, French,
paraphrase, several activities in one sentence, injection attempts, missing facts, large crowds, excluded activities, unknown
activities and personal details.

## What is measured

| Measure | Meaning |
|---|---|
| Activity found | The right activity is the top match |
| Routed right | The decision (price unseen or refer) is the expected one |
| Priced unseen | The share of descriptions the automation prices without a person |
| Referral recall and precision | Of the cases that need a person, how many are sent to one, and how many of those sent needed it |
| **Unsafe automation** | **An event that needed a person but was priced without one. It must stay at zero, at every confidence threshold.** |

Intervals are 95% Wilson intervals ([`metrics.ts`](metrics.ts)). The threshold sweep shows where the confidence a program asks
for can sit before an unsafe case gets through.

## Run it

```bash
npm run eval:smoke                                              # the offline reader, checked against the committed baseline
npm run eval -- --provider replay --embedder transformers       # recorded model answers, multilingual embeddings
npm run eval -- --provider ollama --embedder transformers       # a local model, live (writes a new recording with --record)
npm run eval -- --provider replay --sweep --write               # the threshold sweep, written to reports/
npm run eval:calibrate                                          # re-measure an embedder's scale from the recorded answers
npm run eval:privacy                                            # how many planted personal details reach a model
```

[`recordings/ollama.json`](recordings/ollama.json) holds a local model's answers to the golden set, the one-click examples and
the letters used to set a program up. Replaying them reproduces a live run exactly, so retrieval and scoring can be changed
and re-measured in seconds with no model ([ADR 6](../docs/adr/0006-recorded-answers-and-scale.md)). The offline reader's result
is committed in [`baseline.json`](baseline.json), and a test fails when it falls below it or prices a must-refer case unseen.

[`reports/`](reports) keeps the written results of each setup.

## The privacy evaluation

[`privacy.ts`](privacy.ts) plants personal details in 400 generated descriptions (names with and without a cue, contacts,
addresses, identity numbers, dates of birth, in English and French), protects each text the way a request is protected, and
counts every planted value still in it as one that would have reached a model. With the names model, 4 of 1,040 did; with cue
rules alone, 280. It also checks that the shield changes no golden case and what it costs per text. The result is in
[`privacy.json`](privacy.json) ([ADR 9](../docs/adr/0009-privacy-shield.md)).

## Read the numbers as optimistic

The descriptions and their answers were written for this project, and each embedder's scale (three numbers) was chosen on the
same set. The figures say the pipeline behaves as designed on text its author could imagine, not how it would do on text from
real renters.
