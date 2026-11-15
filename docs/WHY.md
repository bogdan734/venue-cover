# Why it is built this way

Ten decisions, each with what was given up. The longer reasoning is in the [ADRs](adr/).

1. **One modular monolith, not services.** One team, one database, one deploy. Modules can be imported only through their
   `index.ts`, and a test enforces it, so the seams exist for the day a module has to move out. Given up: independent
   scaling of a module. ([ADR 1](adr/0001-modular-monolith.md))

2. **PostgreSQL is the queue.** Every state change writes its event in the same transaction; a relay delivers it. There is
   no second system to keep in step, and no event can be lost or sent for a change that rolled back. Given up: throughput
   past what one database relays, and the ADR says where that is. ([ADR 3](adr/0003-postgres-as-queue.md))

3. **Rules first, the model second.** Text is read by rules; a model reads only what the rules cannot, and where the two
   disagree the stricter answer wins and the case goes to a person. The cost of a wrong call is a quote nobody checked, so
   the number that must stay at zero is unsafe automation, and the evaluation reports it first. Given up: some automation a
   better model would have taken. ([ADR 4](adr/0004-rules-first-intake.md))

4. **The model never sees a person.** Names, contacts, addresses and card numbers become keyed tags before any model reads
   the text; originals are sealed per record and shown only to keys allowed to read them; a guard strips what a call site
   forgot. An agent's key has no right to read personal details, so it gets tags from every route. Given up: a model that
   could use the real name, which it never needed. ([ADR 9](adr/0009-privacy-shield.md))

5. **Recorded answers in tests and in the demo.** A model's answers are recorded once and replayed, so tests are free,
   repeatable and the same on every machine, and a change in accuracy shows as a diff. The embedder's scale was chosen on
   the same cases the evaluation uses, and the README says the figures are therefore optimistic. Given up: a live model in
   the public demo. ([ADR 6](adr/0006-recorded-answers-and-scale.md))

6. **A client is data, not a deployment.** A new client is a template, a form, a look checked for contrast and a launch
   checklist; its portal is the same app. Appearance, contacts and status are columns, every change is in an audit log, and
   a paused client keeps its policies but takes no new business. Given up: a free-form page builder, which would be a
   different product and would invite invented legal text.

7. **Money is integer cents and every premium adds up.** Net, commission, margin, fee and tax always sum to the total, and a
   program's policy list is computed from the same rows as its totals. Given up: nothing; floats would have been the mistake.

8. **REST, GraphQL, webhooks and MCP are four views of the same services.** Writes take an `Idempotency-Key`, webhooks are
   signed and retried with backoff, an OpenAPI document is generated from the routes and a test fails when a route has no
   description. The MCP server asks the person before money moves or a portal opens, on both generations of the protocol.
   ([ADR 5](adr/0005-rest-graphql-mcp.md))

9. **Hand over, never block.** The chat answers from the program's own rules and the renter's own policy; a claim, a refund,
   a request for a person or anything it cannot answer goes to staff with the reason and the policy attached, and the
   assistant goes quiet. Given up: a bot that tries to answer everything. ([ADR 11](adr/0011-conversations.md))

10. **Say what is not real.** Every name and figure is invented, payment and e-mail are simulated, and the demo says so on
    every page. The public demo runs on one machine behind a named tunnel; when that machine is off, a plain page says so.
    ([ADR 10](adr/0010-stable-address.md))

## What would change with real traffic

Per-person sign-in for the back office (it has one shared password), real payment and mail providers behind the interfaces
that already exist, a live model with a spend cap, a queue once one database stops being enough, and a lawyer's reading of
the consent wording before any real message is sent.
