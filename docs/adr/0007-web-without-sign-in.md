# 7. The web app: a public portal, a password-protected back office, and no key in the browser

Status: accepted

## Context

The web app is a showcase that visitors should be able to use at once. It also has areas that belong to different people in a
real business: a renter, an underwriter, finance, a developer. A renter must not be able to act as an underwriter.

## Decision

The pages run on the server and call the API through one server-only client. An area decides whose key it uses: the operator's
for underwriting, programs, developer and quality, and a program's own (issued on first use, by the operator key) for that
program's portal. The browser never holds an API key, and a certificate or a spreadsheet is passed through a route that keeps the
key on the server.

Two surfaces share the server. The **customer portals** (`/portals`, `/p/<code>`) need no password. The **back office** (every
other path) needs one: a shared password sets a signed, expiring, HttpOnly cookie (HMAC-SHA256 over the expiry; five wrong
attempts per fifteen minutes lock a visitor out). `proxy.ts` refuses a stranger before the page runs, and every admin server
action and route handler checks the cookie again, so a mistake in one place does not open the other. With no password set the
back office is open in development and closed in production. `proxy.ts` also limits each visitor (changes, ten sign-in or
registration attempts per quarter hour, and reads at ten times the rate of changes) and sets the security headers: a content
security policy whose scripts need this response's nonce, `nosniff`, no framing, a referrer policy, same-origin resource and
opener policies, HSTS over https. The web app and the API both listen on 127.0.0.1 only, so the only way in from the internet is
the tunnel to the web app, and the visitor's address comes from the tunnel's headers.

## Consequences

- One shared password is a demonstration's access control, not a business's: no per-person identity, no audit of who decided
  what, no revocation of one person. A real deployment puts an identity provider in front of the back office and maps a person to a
  role; the API already authorises by key and scope, so that change is at the edge.
- Every page is rendered per request, which the nonce needs anyway: Next puts it on the scripts it writes, and `'strict-dynamic'`
  lets those load the rest. Inline style attributes stay allowed, because the charts set widths and delays that way; a style
  cannot run code.

## Rejected

- **A key or a role header in the browser.** Anyone could become the underwriter by editing a header.
- **A password check in the proxy alone.** One missing matcher would open everything.
- **No sign-in, as the first version had.** Fine for a local demo; wrong for an address people are given.
