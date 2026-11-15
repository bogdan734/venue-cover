# 3. PostgreSQL as the queue: a transactional outbox

Status: accepted

## Context

A change of state must reach other systems (webhooks, the live feed, certificate e-mail) exactly when it is true and never
when it is not. Writing the row and then publishing a message can do either: a crash between the two loses the message, and a
rollback after the publish sends one for a change that never happened.

## Decision

A state change appends a row to `outbox_event` **in the same transaction**. A relay drains it with `FOR UPDATE SKIP LOCKED`,
one event per transaction, so several relays can run and a failing handler cannot block the others. A handler that keeps
failing parks its event after five attempts instead of blocking the queue. Delivery is therefore at least once, and every
event carries an id so that a receiver can deduplicate (`docs/events.md`).

Webhook deliveries are rows too: leased, retried at 30 seconds doubling up to an hour with jitter, eight attempts, then dead,
with a `webhook.delivery.failed` event and a replay that keeps the event id. The client refuses private addresses and does
not follow redirects. State-changing POSTs take an `Idempotency-Key`; the key row commits with the work, so a retry after a
crash neither repeats nor loses it.

## Consequences

- No Redis, no broker, no second system to keep consistent.
- Throughput is bounded by one PostgreSQL. At the point where event volume or fan-out outgrows it, the relay is the one piece to
  replace with SQS or a log: handlers and receivers do not change, because they already tolerate duplicates.

## Rejected

- **Redis or BullMQ, Kafka.** A second store with its own consistency problem, for a load this system does not have.
- **Publishing after commit.** Loses events on a crash.
