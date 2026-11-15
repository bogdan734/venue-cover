# 2. Not built on Medusa; where it would map

Status: accepted

## Context

A public job post for this kind of platform role lists Medusa.js as a nice-to-have. Medusa v2 is a commerce framework with
modules, workflows and an admin. Whether any real platform runs on it is not stated in a public source (see
`docs/research/2026-11-13-platform-base.md`).

## Decision

Build the platform as its own modular monolith (ADR 1) and record how it would map onto Medusa, so that a move is a mapping and
not a rewrite:

| Here | In Medusa v2 |
|---|---|
| Coverage product | Product |
| A rate row (class, limit, alcohol, band) | Variant with a price rule |
| Program | Sales channel |
| Quote | Cart |
| Referral | A long-running workflow step, resumed by the underwriter's decision (`setStepSuccess`) |
| Policy | Order |

## Consequences

- The outbox, the idempotency keys and the API contracts, which are what the exercise is about, are written here and not
  hidden by a framework's conventions.
- Commerce features (a storefront, carts for shipped goods, an admin) are not reused. They were not needed.

## Rejected

- **Medusa as the base.** Its cart completion rules assume shipped goods, and the part worth showing sits underneath it.
- **A thin Medusa adapter now.** It would be built against a stack nobody confirmed.
