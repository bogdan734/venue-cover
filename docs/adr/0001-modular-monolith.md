# 1. A modular monolith on PostgreSQL

Status: accepted

## Context

The system has to show a REST and GraphQL API, signed webhooks, an event stream, an MCP server, background workers, and
reports, and one reviewer has to be able to read the core in ten minutes. It also has to be changed quickly while the
domain is still being learned.

## Decision

One Node service (`apps/api`): Fastify 5, TypeScript in strict mode, Kysely over PostgreSQL 17 with SQL migrations. Code is
split into modules under `src/modules/<name>/`. A module's `index.ts` is its only public surface: other modules, the server
and the evaluation code import from it and from nothing deeper, and a test fails when they do not. A module does not read
another module's tables. Pure functions (rating, the underwriting decision, the question engine, the policy list)
sit apart from the code that touches the database, so the rules that matter are tested without it.

The MCP server (`apps/mcp`) and the web app (`apps/web`) are separate workspaces and talk to the API like any other client.

## Consequences

- One deployable, one transaction boundary, one place to read. The cost is that a module can only be made independent later
  by splitting at a boundary the test has already kept clean.
- Every module boundary is a place a service could be cut. None was cut, because nothing here needs it yet.

## Rejected

- **Microservices.** Distributed transactions and deployment for a domain this size would hide the design.
- **NestJS.** More ceremony than the reading time allows; the boundary test gives the same discipline.
- **Prisma or Drizzle.** Kysely keeps the SQL visible, which matters for the outbox locking and the vector queries.
