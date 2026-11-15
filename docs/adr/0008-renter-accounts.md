# 8. Renter accounts with a confirmed e-mail, and a demo inbox that belongs to one browser

Status: accepted

## Context

A renter pays for a policy and later needs its certificates, often for the venue on the day. Without an account, a policy and its
certificates are only as reachable as the address typed into one form. A showcase also has to show that the platform handles
people's credentials properly, while no real e-mail may leave it.

## Decision

Accounts live in the API (module `accounts`), are shared by every program's portal, and name a person, not a partner: a call
still needs an API key, and the renter rides along in a `Renter-Session` header that the web app keeps in an HttpOnly cookie.

- **Registration does not reveal who is registered.** A new and a taken address get the same answer; the mail to the address says
  which it was. A second registration changes nothing about the existing account. The confirmation link is single-use, lasts 30
  minutes, and signs the person in, which is what a password reset link proves too. At most three links per account per half hour.
- **Passwords** are hashed with scrypt and a salt per account. Signing in with an unknown address still costs one scrypt, so timing
  does not reveal it. Five wrong passwords lock the account for 15 minutes. Sessions last 14 days. Tokens of either kind are stored
  as SHA-256 hashes only.
- **Opening the link changes nothing.** It leads to a page with a button, so a mail scanner that follows links cannot use it up.
- **Buying on a portal needs a confirmed account.** That is the portal's rule, not the API's: partners and agents still bind
  through the API. The quote page shows the sign-in in place of the card, the server action checks again, and the way back to
  the price waits in a cookie while the person is away confirming.
- **The demo inbox belongs to the first browser that claims an address.** The simulated mail provider hands that browser the one
  key that reads the address's mail (`POST /v1/demo/mailboxes`, operator key only); anyone typing the same address later gets
  nothing, so they cannot read someone else's confirmation link and take the account. It is the demo's stand-in for owning a
  mailbox.

## Consequences

- Claims and mail live in the API's memory, as the simulated mail always did: a restart empties every inbox, and the browser simply
  claims its address again on the next registration.
- One account sees its quotes on every portal. A white-label business might want an account per client program instead; the
  `renter` table would gain a program column.

## Rejected

- **A third-party identity service.** It needs an account and a key someone would have to create, and the point is to show the
  design.
- **Passwordless magic links.** Fine in production, harder to reason about on a shared demo where the inbox is simulated.
- **Signing in at registration.** It would tell anyone which addresses already have an account.
- **An inbox keyed by a signed cookie with the address.** Anyone could register someone else's address and read their mail.
