# 10. A stable public address for a demo that runs on one machine

Status: accepted

## Context

The demo runs on one computer, so the only way in from the internet is a tunnel. A Cloudflare quick tunnel needs no account
but gives a new address on every run, which is wrong for a link that is sent to a reviewer and opened a day later. A named tunnel
has a fixed identity, but publishing it needs a hostname in a domain on the account, and there was none.

## Decision

The address is a Worker on the account's free `workers.dev` name. The Worker (`deploy/cloudflare-worker.js`, about 25 lines)
reaches the web app through a Workers VPC service bound to a named tunnel; `cloudflared` on the machine runs that tunnel with a token.
No domain is needed, and the address does not change between runs.

- **What the Worker does.** It forwards each request to `127.0.0.1:3100` through the binding, with the visitor's address and the
  host they used in `X-Forwarded-*` headers, because the web app limits and builds links per visitor and per host. It does not follow
  redirects, so the app's own redirects reach the browser. When the machine is off, the tunnel is down and the Worker answers 503 with
  a plain message instead of an error page.
- **What stays on the machine.** The database, the API, the models, the admin password and the tunnel token (`.env.public`, ignored
  by git). The Worker holds no secret and stores nothing. `npm run public` falls back to a quick tunnel when the token is absent.
- **The same locks as before.** The admin console still needs its password; the API is not reachable except through the web app.

## Consequences

- The reviewer's link is up only while the computer is on and `npm run public` runs. A 503 says so.
- Workers VPC is in beta, and the free Workers plan has a daily request limit; both are fine for a demo that a few people open.
- The account's `workers.dev` name is part of the address, and it is derived from the account's e-mail when the account is made. It
  can be renamed in the Workers settings; the address then changes, and `PUBLIC_URL` in `.env.public` follows.
- A domain would remove the Worker: a named tunnel could publish a hostname directly, and Cloudflare Access could sit in front of the
  back office instead of a shared password.

## Rejected

- **A quick tunnel only.** The address changes on every run.
- **A Worker that stores the current quick-tunnel address.** A moving target, and a place for state that should not exist.
- **Buying a domain for this.** A recurring cost for a demo, and money to spend.
