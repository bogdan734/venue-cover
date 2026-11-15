# API

The service behind everything else: one Node process with Fastify 5, TypeScript in strict mode, Kysely on PostgreSQL 17
(pgvector and pg_trgm) and plain SQL migrations. REST, GraphQL, a live event stream, signed webhooks and the workers that run
them are all here.

## Run it

```bash
npm run db:up                     # from the repository root: PostgreSQL 17 with pgvector on port 54329
cp .env.example .env              # from the repository root
npm run dev -w apps/api           # http://127.0.0.1:3000
npm run key -w apps/api -- --name ops --scopes programs:manage,reports:read   # prints an API key once
```

Read the API itself rather than a page about it: `GET /v1/openapi.json` (generated from the routes; a test fails when a route
has no description or a description has no route), `/graphql`, `GET /v1/events/stream` and [`docs/events.md`](../../docs/events.md).

## Modules

Each module under [`src/modules`](src/modules) has one public surface, its `index.ts`. Another module may import only that, and
[`test/boundaries.test.ts`](test/boundaries.test.ts) fails when one does not. A module never reads another module's tables.

| Module | What it owns |
|---|---|
| `intake` | Reading an event description: personal details masked, facts extracted (rules, then a model behind `LlmProvider`: recorded, keyword, Ollama or Anthropic), classification |
| `catalogue` | Activities and their embeddings (a lexical embedder, or a multilingual model in process) and the match against a phrase |
| `underwriting` | Pure functions: the decision (price on the spot or refer, and why), sanctions screening, the pricing worksheet |
| `rating` | The rate card, effective-dated, and the premium split into net, commission, margin, fee and tax |
| `quotes` | Quotes, binding, referrals and their queue, the underwriter's decision |
| `policies` | Issuing a policy, its frozen snapshot and a certificate per party |
| `programs`, `setup`, `tenants` | Client programs: versioned rules, a template and a letter turned into a draft, the lifecycle, appearance, contacts, audit log, visits, the hub, client console links |
| `questions` | The follow-up questions each program asks, as data |
| `submissions` | Large events: a fillable PDF form and attachments, with a check of what is still missing |
| `claims` | Notice of loss against a policy |
| `reporting` | The policies issued in a month, per program or for all, as JSON or CSV |
| `shadow` | A replay of decided referrals through today's model and rules |
| `events`, `webhooks` | The transactional outbox and its relay; endpoints, signed deliveries, retries, replay, test events |
| `privacy` | Tags in place of personal details, sealed originals, the guard on every model call, the gate for keys without `personal:read` |
| `accounts`, `auth` | Renter accounts with a confirmed e-mail; API keys, scopes and idempotency |
| `conversations` | The portal chat, the staff inbox and the Telegram channel |

## Conventions

- **Money is integer cents.** A premium always sums to its total.
- **Every state-changing `POST` takes an `Idempotency-Key`.** The same key and body give the same answer; the same key with a
  different body is refused.
- **Every state change writes its event in the same transaction** (`outbox_event`); a relay delivers it at least once.
- **A key has scopes** (`quotes:read`, `quotes:write`, `referrals:decide`, `webhooks:manage`, `reports:read`,
  `programs:manage`, `conversations:manage`, `mail:read`, `personal:read`) and may be bound to one program. A program a key may
  not touch looks exactly like one that does not exist.
- **Errors are `{ "error": { "code", "message" } }`** with a stable code.

## Tests

```bash
npm test -w apps/api              # needs the database from `npm run db:up`
```

[`test/app.ts`](test/app.ts) builds the whole server on a fresh database with a controllable clock, a scripted model,
simulated payments and a recording webhook receiver, so a test reads as what a client would do. Nothing in them depends on a
network or a key.
