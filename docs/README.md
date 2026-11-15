# Documentation

| | |
|---|---|
| [`WHY.md`](WHY.md) | Ten decisions, each with what it gave up, and what would change with real traffic |
| [`adr/`](adr) | Eleven decision records: context, decision, consequences |
| [`events.md`](events.md) | Every event: when it is written, its payload and its delivery guarantee |
| [`research/`](research) | Short prior-art briefs with their sources: the platform base, what a client-facing hub needs, keeping personal details from a model |
| [`media/`](media) | The tour, the screenshots and the cover image, and how they are made |

## Decision records

1. [A modular monolith on PostgreSQL](adr/0001-modular-monolith.md)
2. [Not built on Medusa; where it would map](adr/0002-not-medusa.md)
3. [PostgreSQL as the queue: a transactional outbox](adr/0003-postgres-as-queue.md)
4. [Rules decide; the model only reads](adr/0004-rules-first-intake.md)
5. [REST, GraphQL and MCP over the same services](adr/0005-rest-graphql-mcp.md)
6. [Recorded model answers, and a measured scale for each embedder](adr/0006-recorded-answers-and-scale.md)
7. [The web app: a public portal, a password-protected back office, and no key in the browser](adr/0007-web-without-sign-in.md)
8. [Renter accounts with a confirmed e-mail, and a demo inbox that belongs to one browser](adr/0008-renter-accounts.md)
9. [A privacy shield in front of every model call](adr/0009-privacy-shield.md)
10. [A stable public address for a demo that runs on one machine](adr/0010-stable-address.md)
11. [Conversations: an assistant that hands over, on the portal and in Telegram](adr/0011-conversations.md)
