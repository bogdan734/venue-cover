# MCP servers

Two [Model Context Protocol](https://modelcontextprotocol.io) servers on the same REST API. They hold no state and no rules of
their own: whatever the API decides, the tool reports, and the caller's API key is forwarded so the API stays the one place
that knows what a key may do.

| Server | Tools | Who it is for |
|---|---|---|
| `venue-cover` | `search_activities`, `classify_event`, `create_quote`, `get_quote`, `bind_quote`, `get_policy` | An agent that quotes and binds for a renter |
| `venue-cover-onboarding` | `draft_client`, `set_appearance`, `preview_client`, `publish_client` | An agent that sets a client up from its letter |

## What makes them safe to hand to an agent

- **The person confirms before anything that cannot be taken back.** `bind_quote` asks before money moves and `publish_client`
  before a portal opens, through elicitation, on both generations of the protocol. A client that cannot ask gets a refusal, not
  a charge.
- **An agent reads people as tags.** A key without `personal:read` gets every name and e-mail as a tag such as `[NAME#7K3Q2A]`
  from the API; the tag can be handed back to quote for the same person, and the real name appears only in the confirmation the
  person sees.
- **A quote can come back referred.** That is a state, not an error: an underwriter decides, and it cannot be bound until then.
- **The onboarding key manages programs and nothing else.** It cannot read a report or take a payment, and every change it makes
  is in the audit log under its key's name.
- **A retry does not repeat itself.** Tool calls derive their `Idempotency-Key` from what was asked.

## Run them

```bash
# over HTTP: /mcp and /mcp/onboarding, with the caller's key as a bearer token
VENUE_API_URL=http://127.0.0.1:3000 MCP_PORT=3300 npm run start:http -w apps/mcp

# on stdio, for a host that starts the server as a process
VENUE_API_URL=http://127.0.0.1:3000 VENUE_API_KEY=<key> npm run start:stdio -w apps/mcp
VENUE_MCP=onboarding VENUE_API_KEY=<a key with programs:manage only> npm run start:stdio -w apps/mcp
```

`VENUE_PERSONAL_KEY` (a key of the same program that may read personal details) is used only to word the confirmation the person
sees; no tool result ever uses it.

## Tests

```bash
npm test -w apps/mcp
```

The tests run a real client against the server in memory and over HTTP, for clients of both protocol generations: the tools and
their schemas, a quote that is the same when the call is repeated, a referred quote reported as a state, API errors returned as
tool errors, a bind that charges nothing when the person declines, cancels or leaves the box unticked, tags that reach the model
in place of names, and the onboarding flow end to end, including its audit trail.
