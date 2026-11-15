# Events

Every change of state that another system may care about is written as an event in the same database transaction
as the change itself (the transactional outbox). A relay then hands each event to its handlers and to the webhook
fan-out, so an event exists if and only if the change committed. Events are delivered at least once: a receiver
that gets the same `id` twice should do nothing the second time.

Money in every payload is an integer number of cents.

## The envelope

Webhooks and the live stream carry the same shape:

```json
{
  "id": "6f1c…",
  "type": "policy.issued",
  "programId": "prg_1",
  "createdAt": "2026-11-13T12:00:00.000Z",
  "data": { }
}
```

## Receiving webhooks

- Register an endpoint with `POST /v1/webhook-endpoints` (https only; addresses that point at a private network are
  refused, and redirects are not followed). The signing secret is shown once.
- Each request carries `x-signature: t=<unix seconds>,v1=<hex>` where the hex is the HMAC-SHA256 of
  `<t>.<raw body>` with the secret. Check it against the raw bytes and reject a `t` that is more than a few minutes old.
  Also sent: `x-event-id`, `x-event-type` and `x-delivery-attempt`.
- Any 2xx answer counts as delivered. A timeout, a network error, a 408, a 429 or a 5xx is retried after 30 seconds,
  then doubling up to one hour, with jitter, for eight attempts. Any other answer (a 404, say) is final. A delivery
  that is final or out of attempts is marked dead and a `webhook.delivery.failed` event is recorded;
  `POST /v1/webhook-deliveries/:id/replay` sends it again with the same event id.
- Order is not guaranteed between events. Use the `id` to deduplicate and the ids inside `data` to fetch current state.

## The live stream

`GET /v1/events/stream` is a server-sent events feed of the same events. The frame `id` is the sequence number of the
event, so a client that reconnects with `Last-Event-ID` continues where it stopped; without it the stream starts at
the live end. A key bound to a program sees its own program's events; a key without a program sees all of them.

## `quote.created`

A quote was priced or referred. Webhook: yes.

| field | meaning |
|---|---|
| `quoteId` | the quote |
| `state` | `quoted` or `referred` |
| `totalCents` | the premium, or `null` when the event could not be priced |

## `quote.referred`

A quote went to an underwriter. Webhook: yes.

| field | meaning |
|---|---|
| `quoteId` | the quote |
| `reasons` | why, from `LOW_CONFIDENCE`, `UNKNOWN_ACTIVITY`, `EXCLUDED_ACTIVITY`, `CLASS_CONFLICT`, `OVER_CAPACITY`, `NO_RATE`, `SANCTIONS_POSSIBLE_MATCH`, `PROGRAM_RULE`, `EXTRACTION_FAILED`, `MISSING_FACTS` |

## `referral.decided`

An underwriter approved or declined a referral. Webhook: yes.

| field | meaning |
|---|---|
| `referralId`, `quoteId` | the referral and its quote |
| `action` | `approve`, `approve_with_override` or `decline` |
| `state` | the quote's state afterwards: `quoted` or `declined` |

## `policy.issued`

A quote was paid for and became a policy. Webhook: yes.

| field | meaning |
|---|---|
| `policyId`, `policyNumber`, `quoteId` | the policy and its quote |
| `totalCents` | what the customer paid |

## `certificate.ready`

The certificates of insurance were e-mailed. Webhook: yes.

| field | meaning |
|---|---|
| `policyId`, `quoteId` | the policy and its quote |
| `holders` | who received one: `insured`, and `venue` and `broker` when the booking reference identified the rental |

## `certificate.unrouted`

A policy was issued without a booking reference that identified a rental, so the venue and the broker got no
certificate and somebody has to send them one. Webhook: yes.

| field | meaning |
|---|---|
| `policyId` | the policy |
| `bookingRef` | the booking reference that was given, or `null` |

## `program.rules_published`

New underwriting rules were published for a program. They apply from `effectiveFrom`; earlier quotes keep the rules
they were made under. Webhook: yes.

| field | meaning |
|---|---|
| `programId` | the program |
| `version` | the new rules version |
| `effectiveFrom` | the first day they apply, `YYYY-MM-DD` |

## `claim.reported`

A loss was reported on a policy. Webhook: yes.

The event names the claim and the policy and gives the date, not what happened or who reported it; fetch the claim
with `GET /v1/claims/:id` if the key allows it.

| field | meaning |
|---|---|
| `claimId`, `policyId`, `policyNumber` | the claim and its policy |
| `lossDate` | the day of the loss, `YYYY-MM-DD` |

## `webhook.delivery.failed`

A webhook delivery ran out of attempts. Webhook: no. It is on the live stream only, so that a failing endpoint
cannot cause more deliveries to itself.

| field | meaning |
|---|---|
| `deliveryId`, `endpointId`, `eventId` | the delivery, its endpoint and the event it carried |
| `reason` | the last error |

## `webhook.test`

A test sent on request to one endpoint (`POST /v1/webhook-endpoints/:id/test`), signed like any other, so a receiver can
be checked before real events reach it. Webhook: no, not by subscription: it goes only to the endpoint it was sent to.

| field | meaning |
|---|---|
| `endpointId` | the endpoint it was sent to |
| `message` | says that no action is needed |
