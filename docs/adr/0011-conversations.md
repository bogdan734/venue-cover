# 11. Conversations: an assistant that hands over, on the portal and in Telegram

Status: accepted

## Context

Renters ask the same few things: what is covered, how to get a price, where their policy is. They also report claims and ask for
refunds, which a person must handle. Reviews of event insurers praise speed and complain about claims that drag with little
word back. A support bot is accepted as a first contact; it fails when it blocks a person or makes someone repeat themselves
(`docs/research/2026-11-14-hub-features.md`). The demo runs on one machine without a public address for inbound calls, and tests
must not spend money on a model.

## Decision

- One conversation model for every channel: a `conversation` per program and chat, `message` lines from the renter, the
  assistant or staff, and a state: the assistant has it, it waits for a person, a person has it, or it is closed. The channel is
  an adapter; the web chat and Telegram are the two built.
- The assistant reads intent with rules first, on the text as written, inside the process. Only what the rules cannot read goes
  to the model, as protected text through the same shield and guard as an event description (ADR 9), and a failure counts as
  "cannot answer". It answers only from the program's own data: its rules in force, its contacts, and a policy shown to its
  holder (signed in, or the policy number with the e-mail on it).
- A claim, a refund, a request for a person or anything it cannot answer hands the conversation over, with the reason and the
  policy in its context, and says when people answer. While a person is waiting or answering, the assistant is quiet.
- Lines are stored as protected text with the originals sealed per message. A key with `personal:read` (the portal, the inbox)
  reads them as written; any other reads tags.
- The web chat proves it is the same browser with a secret in an HttpOnly cookie; only its hash is stored.
- Telegram is long-polled (`getUpdates`), so nothing on this machine has to be reachable. `/start CODE`, which a portal's
  Telegram link sends, ties the chat to that program; group chats are ignored. A staff reply is sent before it is stored.
- A chat needs no number to ask. Without a venue it is offered the venues as buttons (a tap sends the venue's name); a policy
  number in a first message names its venue, because a number starts with the venue's code. Only a policy needs proof: the
  number with the e-mail on it, and nothing is shown or added before that. A claim or a refund without a policy is asked, once,
  for its number, and a number sent while the case waits for a person is checked and added to the case. The bot describes itself
  (a description for an empty chat, a profile line, `/start`, `/help` and `/person`) from the platform's own start, so the
  profile cannot drift from what the bot does; its picture is set once by `npm run bot:avatar`.
- The portals also open inside Telegram, as a Mini App: the bot's menu button opens the list of portals, and the greeting of
  a portal carries a button that opens that portal. The page posts Telegram's few events itself instead of loading Telegram's
  script, so the strict script policy stays as it is; only the portal pages may be framed, and only by Telegram on the web.
  The name Telegram passes is used, to fill in the form, only after the server has checked the bot's signature on it.

## Consequences

- The common questions are answered in milliseconds without a model, and the answers cannot drift from the rules in force.
- A person picks a case up without asking the renter to repeat it.
- One process can poll a bot token at a time, so the tests never get the demo's token.
- Telegram on the web shows a Mini App in a frame, where a browser keeps the portal's sign-in cookie apart from the rest:
  describing, pricing and the chat work there, and paying is smoother in Telegram's apps or the browser.
- WhatsApp, Viber, SMS and voice are not built: each needs a business account and money. A new channel is an adapter that turns
  its messages into `receive` calls and sends replies.
- Commercial messages in Canada need consent (CASL); this sends only answers to the renter's own messages. Not legal advice.
