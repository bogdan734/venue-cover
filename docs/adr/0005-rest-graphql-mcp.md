# 5. REST, GraphQL and MCP over the same services

Status: accepted

## Context

Partners integrate in different ways: a typed REST client, a GraphQL query that asks for exactly the fields it needs, and now
AI agents that call tools.

## Decision

REST is the primary contract and is described by an OpenAPI document built from the route catalogue plus hand-written
operation notes; a test fails when a route has no note or a note has no route. GraphQL (mercurius) calls the same service
functions and batches nested fields with loaders so that the number of queries does not grow with the result. The MCP server
(SDK v2) wraps the REST API with six tools, forwards the caller's key, and before it binds a quote asks the person to confirm,
through the protocol's input request (or elicitation, for older clients). Declining or ignoring the question charges nothing.

All three share one error shape, one idempotency rule and one set of scopes.

## Consequences

- A capability is added once, as a service function, and exposed three times. The cost is keeping three thin layers in step; the
  OpenAPI test and the MCP tests, which run against the real API, are what keep them honest.
- An agent cannot spend a customer's money on its own: the confirmation is the protocol's, not a convention.

## Rejected

- **GraphQL only.** Partners expect REST and webhooks in this domain.
- **An MCP server with its own logic.** It would drift from the API; it is a client of it.
