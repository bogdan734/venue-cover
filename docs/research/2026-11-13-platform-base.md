# Prior art: platform base for the event-liability showcase (2026-11-13)

## Question and constraints

What should a showcase platform for facility-user and special-event liability insurance be built on, so that it
demonstrates the work of a senior core platform engineer (REST, GraphQL, webhooks, events, MCP, PostgreSQL, Node.js and
TypeScript) plus pragmatic LLM use with a human fallback? Constraints: synthetic data only, tests cost nothing (fake
providers, local Ollama, in-process embeddings), one reviewer must be able to read the core in ten minutes, and a first usable version must exist within days.

## Options

| Option | What it is | Fit | Cost and risk | Source |
|---|---|---|---|---|
| Own modular monolith (Fastify, Kysely, PostgreSQL) | One Node service with module boundaries, outbox and state machine | Every required skill maps to a visible module | Auth, admin views and retries are ours to write, in small versions | this brief |
| Medusa v2 as the base | Commerce framework: modules, workflows (long-running steps resumed by `setStepSuccess`), admin | Named in the job post as a nice-to-have; coverage could map to product, quote to cart | Heavy setup, cart completion rules for non-shipped goods, framework hides the patterns we must show | Medusa docs, workflows-sdk 2.14.x |
| OpenInsure | Open-source MGA platform (Apache 2.0 per its docs), PlanetScale and SpiceDB | Same domain | Reuse would hide our own design; repository not verified | docs site, secondary |
| Openkoda | MIT insurance platform on Java and Spring Boot | Wrong stack | Not applicable | DEV article, secondary |

## Recommendation

Build the own modular monolith and record the Medusa mapping as an ADR (coverage to product, rate cell to variant,
program to sales channel, quote to cart, referral to a long-running workflow step, policy to order). The job post lists
platform surface and architecture ownership as the core and Medusa only as exposure. A thin Medusa adapter stays an
optional later task, promoted if the target stack is confirmed.

## Improvements worth trying

- MCP `bind_quote` asks the end user to confirm through elicitation (`ctx.mcpReq.elicitInput`) before any bind.
- Multilingual in-process embeddings (`Xenova/multilingual-e5-small`, 384 dimensions, `query:` and `passage:` prefixes)
  so French event descriptions match an English catalogue with no API cost.
- PostgreSQL as the only infrastructure: pgvector, pg_trgm, outbox drained with `FOR UPDATE SKIP LOCKED`.

## Open questions

- Is the target company's new platform built on Medusa? Not confirmed by any public source.
- MCP TypeScript SDK v2 is recent: read the official v2 docs before writing the server.

## Sources

- Job post, Senior Core Platform Engineer: https://wellfound.com/jobs/4964699-senior-core-platform-engineer (2026-11-13, primary)
- Company site: https://www.ircnow.com/ (2026-11-13, primary)
- Medusa workflow engine: https://docs.medusajs.com/resources/infrastructure-modules/workflow-engine/how-to-use/index.html.md (primary)
- MCP TypeScript SDK v2 index: https://ts.sdk.modelcontextprotocol.io/v2/llms.txt (2026-11-13, primary)
- Embedding model card: https://huggingface.co/Xenova/multilingual-e5-small (primary)
- OpenInsure docs: https://oi-sys-docs.pages.dev/ (secondary, not opened: navigation refused)
- Openkoda overview: https://dev.to/openkoda/openkoda-most-customizable-insurance-software-platform-11fj (secondary)
