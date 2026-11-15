# 9. A privacy shield in front of every model call

Status: accepted

## Context

Renters write descriptions the way they write e-mails: "my daughter Emma", a phone number, an address, sometimes a card
number. The model that reads them may be a cloud one. Underwriters still need the details to decide, and the renter expects
to see their own words back. The research brief is `docs/research/2026-11-14-privacy-shield.md`.

## Decision

A `privacy` module protects every text before a model reads it, and the server makes it impossible to forget.

- **Detection.** Rules find what has a shape: e-mail, phone, postal code, street address (English and French), date of birth
  (only after a cue such as "born"), and every run of nine or more digits, called a card or a SIN when its checksum says so.
  Names come from a local multilingual NER model (DistilBERT, int8 ONNX, 135 MB, run in process by transformers.js) when it
  is on disk, and from cues ("my daughter Emma", "Contact: Sarah Thompson", "Thanks, Sarah") always. A word joined to a name
  by "and" is a name, and a later mention of a name's word is the same person.
- **Tags.** Each detail becomes `[KIND#7K3Q2A]`: the kind, and 30 bits of an HMAC of the value under a key for the client
  program, derived with HKDF from one platform secret. The same value has the same tag within a program and an unrelated one
  in another, so tags cannot be joined across clients.
- **Sealed originals.** A classification stores the tagged text (what the model, the search index, the labelled examples and
  the reports use) and the originals sealed with AES-256-GCM under the program's key, the record id bound in as associated
  data. Only keys with the `personal:read` scope get the description back as written: the portal and the back office. A key
  issued to an AI agent is made without it.
- **A guard on the model.** The server wraps the model it is given; the untrusted part of every prompt is checked again just
  before it leaves, and what still looks personal is replaced by its kind. `GET /v1/privacy` reports how many calls it checked
  and how much it had to strip: zero while every call site protects its text.
- **Recordings** of model answers are keyed with tag ids left out, since they depend on the deployment's secret.

## Consequences

- Measured on 400 invented descriptions the rules were never tuned on, with 1,040 details planted (`npm run eval:privacy`):
  4 reached the model with the names model on (two texts where the model took both first names for a brand and a city at the
  start of a sentence), 280 with cue rules alone (names nothing points at), and every identifier with a shape was caught by
  both. No golden case without personal details is changed, so accuracy with the shield is accuracy without it. It costs
  about 3 ms a text with the model, 0.3 ms without. The "and" rule was added after a first run on a different sample.
- This is pseudonymisation, not anonymisation: a rare mix of details can still point at someone, and in law the data stays
  personal. The shield adds to the controls around the data; it does not replace them.
- Changing the secret makes stored originals unreadable. Key rotation (re-sealing under a new key) is not built.
- Agents get the same treatment over the API. One `preSerialization` hook stands in front of every route, REST and GraphQL:
  for a key without `personal:read` every contact in an answer (an object with an e-mail, or a quote's holder) leaves as
  tags, keyed by the record's program, and each tag given out is remembered, sealed, in `pseudonym`. A tag handed back in a
  quote is turned into the value it stands for; one the program never gave out is refused. Certificates name people and a
  PDF cannot carry tags, so they need `personal:read`. The MCP server's own key is made without it; a second key of the same
  program words the confirmation the person sees before paying (an elicitation goes to the person, not the model), and never
  a tool result.
- Free text other than descriptions (a claim's account of a loss, a large event's application) and the policy CSVs are
  for people and are not tagged.

## Rejected

- **A Python service (Presidio) beside the API.** The reference design, but a second runtime for a demo.
- **A hosted redaction API.** The text would reach a third party before it reached the shield.
- **A list of first names.** It needs third-party data, and the evaluation would test the list it was built from.
- **Masking without a way back** (the first version replaced values with `[email]`). Underwriters lost details they need,
  and the renter could not see their own words.
