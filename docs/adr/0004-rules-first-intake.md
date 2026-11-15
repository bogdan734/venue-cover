# 4. Rules decide; the model only reads

Status: accepted

## Context

Customers describe events in free text, in English or French, with typos, and sometimes with instructions aimed at the model.
A model that classifies and prices on its own cannot be measured for drift and cannot be trusted with a customer's words.

## Decision

The pipeline is: mask personal details; extract facts with a model behind a small interface (`LlmProvider`: keyword reader,
recorded answers, local Ollama, Anthropic); cross-check the facts with plain rules; match each activity to the catalogue (cosine
similarity of multilingual embeddings blended with trigram overlap); decide with a pure function of the facts, the match and
the program's rules.

- The model returns JSON facts only. It is never given authority to price, approve or choose a class.
- Where the model and the plain rules differ, the stricter reading wins and the result is marked degraded, which refers the case.
- The text is wrapped as untrusted data, and a test set includes texts that tell the model to approve them.
- A phrase that matches nothing closely enough becomes `UNKNOWN_ACTIVITY` and goes to a person. The class of a mixed event is
  the highest class named, so mentioning a risky extra never makes it cheaper.
- A person's decision is stored with the description, so it becomes a comparable for the next case and a label for evaluation.

## Consequences

- The part that decides is deterministic and tested without a model. A better or cheaper model is a change of one provider and
  a re-run of the evaluation (ADR 6).
- The cost is a catalogue and rules to maintain, which is where an underwriter's judgement belongs anyway.

## Rejected

- **An LLM that classifies and prices.** Its drift cannot be measured and its mistakes cannot be explained to a customer.
- **Keywords only.** Fails on paraphrase, typos and French (see the evaluation).
