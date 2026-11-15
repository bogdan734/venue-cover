# Web app

Next.js 16 (App Router, React 19), Tailwind 4 and a design of its own: hairlines instead of shadows, a serif for titles, figures
in the text face with tabular digits so columns add up by eye, and a dark rail for the back office so it never looks like a
client's portal. The principles are in [`PRODUCT.md`](../../PRODUCT.md); the colours, faces and radii are tokens in
[`app/globals.css`](app/globals.css).

## Areas

| Address | Who | What |
|---|---|---|
| `/portals` | Anyone | The front door: a portal for each client program |
| `/p/<code>` | A renter | Describe an event, see how it was read, answer the program's questions, pay, get the policy and certificates, report a loss; an account across portals and a demo inbox |
| `/c/<code>` | A client | Its own figures and policies, by a link the operator can turn off |
| `/embed/<code>.js` | A venue's website | One line that adds an "Insure your event" button in the client's colour |
| `/portals`, `/p/<code>` in Telegram | A renter | The same portals as a Telegram Mini App, from the bot's menu button or its greeting |
| `/` `/underwriting` `/inbox` | Staff | The tour; the referral desk with a pricing worksheet; the chat from the portals and Telegram |
| `/programs` | Staff | The hub: every client, its status and last 30 days; a client's appearance, contacts, launch checklist, console links and change log |
| `/developer` `/quality` | Staff | The live feed, webhooks, requests and GraphQL; the evaluation and the shadow replay |

## How it is put together

- **The browser never holds an API key.** [`lib/api.ts`](lib/api.ts) is server-only and calls the API as the operator, as one
  program (a portal) or as one program's client console. The area of the app decides the key, not the visitor
  ([ADR 7](../../docs/adr/0007-web-without-sign-in.md)).
- **The back office is behind a password** (a signed, expiring, HttpOnly cookie) and closed when none is set. Every admin
  server action checks again, so a mistake in one place does not open the other.
- **One proxy in front of every request** ([`proxy.ts`](proxy.ts)): a Content Security Policy with a nonce per response,
  per-visitor limits (writes, reads, and ten sign-in attempts per 15 minutes), the security headers, and the rule for who may
  see what.
- **A client's look is data.** A portal takes its colour from the program, and the API has already refused a colour that cannot
  be read at 4.5:1 against the page.
- **Visitors are counted once a day without keeping who they were**: the idempotency key a portal sends is a keyed hash of
  address and browser ([`lib/visits.ts`](lib/visits.ts)).

## Run and test

```bash
npm run demo                  # from the repository root: a fresh database, the API and this app, on http://localhost:3100
npm run e2e -w apps/web       # the browser tests, against the real API, in the installed Chrome
npm test -w apps/web          # unit tests: the session, the rate limiter, the proxy, formatting
```

The end-to-end tests start their own server ([`e2e/serve.ts`](e2e/serve.ts)) on ports 3200 and 3201 with the same invented data
and a recorded model, so they need no key and do not touch a running demo. [`e2e/screens.ts`](e2e/screens.ts) and
[`e2e/film.ts`](e2e/film.ts) drive the same pages for the screenshots and the film in [`docs/media`](../../docs/media).
