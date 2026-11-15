# What the hub should do, by who uses it (14 Nov 2026)

**Question.** The demo is becoming a hub: one back office that sets up and watches many client portals. Which features do the
four kinds of users actually need, and which would only be decoration? Constraints: free to run (no domain, no paid channels), one
machine, a Canadian audience, invented data, nothing that needs a model that costs money in tests.

The evidence is thin and mostly vendor writing and review sites, so each row says how much weight it carries. It points the same
way from several directions, which is what the plan relies on.

| Who | What the sources say | Weight | Source |
|---|---|---|---|
| Renter | Praised for speed: a quote and the certificate in an hour where an agent took weeks. Complaints are about claims that drag with little communication, exclusions found only at claim time, and refunds. | Reviews, anecdotal | [Trustpilot](https://www.trustpilot.com/review/thimble.com?page=7), [Merchant Maverick](https://www.merchantmaverick.com/reviews/thimble-insurance-review) |
| Renter | A venue or a permit office wants the certificate and the additional-insured endorsement, usually at $1M liability; a certificate alone is refused. | Several public requirement documents | [San Diego](https://www.sandiego.gov/sites/default/files/legacy/specialevents/pdf/Insurance.pdf), [Costa Mesa](https://costamesaca.gov/home/showpublisheddocument/52924/638090415080500000) |
| Renter | A bot is accepted as a first contact; it fails when it blocks a person or makes them repeat themselves. Claims are the stressful moment. | Vendor blogs, unverified figures | [Infobip](https://www.infobip.com/blog/insurance-customer-experience), [Featurebase](https://www.featurebase.app/blog/insurance-chatbots) |
| Operator | New programs and partners take weeks to onboard; five or more disconnected systems; bordereaux not tied to financial events; no audit trail of who changed what. | Vendor blogs, directional | [Insurance Journal](https://www.insurancejournal.com/blogs/selectsys/2026/02/23/858779.htm), [Peakflo](https://peakflo.co/blog/insurance-mga-finance-automation) |
| Client program | Tenant-level white label: own logo, colours, domain and sender; embedded quoting without a login; quote volume rolled up by portal or partner. | Vendor pages | [Verdocs](https://www.verdocs.com/insurance), [Clinked](https://clinked.com/insurance-client-portal) |
| Developer | A sandbox they can try without signing up does more for adoption than anything else; changelog and deprecation policy up front; complete, accurate docs. | Vendor blogs, one cited survey | [Speakeasy](https://www.speakeasy.com/blog/definitive-guide-to-devex-portals), [Torry Harris](https://www.torryharris.com/blog/developer-experience-best-practices) |
| Channels | Telegram's bot API is free, and long polling needs no public address. In Canada, commercial messages need consent (CASL); answers to a person's own inquiry and transaction messages have more room. Not legal advice. | Official FAQ, vendor guides | [Telegram Bots FAQ](https://core.telegram.org/bots/faq), [McInnes Cooper](https://www.mcinnescooper.com/publications/canadas-anti-spam-legislation-casl-10-faqs/) |

## Decision

**Build** what answers a row above and can be shown in a minute:
- Operator: a client lifecycle (draft, test, live, paused), an onboarding wizard that ends with a checklist, a change log, and per-client
  figures that include the loss ratio and the referral wait, not only visits.
- Client program: appearance as data (logo, colours, wording, contacts) with an automatic contrast check; an embeddable button; its
  own read-only console by a revocable link.
- Renter: what is covered and what is not, and the refund rule, before paying; a chat on every portal that hands over to a person
  with the case attached; a claim timeline with messages as it changes.
- Developer: a self-serve sandbox key that expires, a log of one's own requests, a changelog.
- Channels: the web chat and Telegram, real. Both go through the same shield, classifier and rules as everything else.

**Skip**, and why:
- A free-form page builder: a different product, worse than the portal, and invites invented legal and price text.
- WhatsApp, Viber, SMS and a phone agent: each needs a business account, checks and money, and Viber is rare in Canada. The channel is
  an interface, so one is added later without touching the rest.
- Per-client subdomains and custom domains: they need a domain. Tenants resolve by host or by path, so it is one setting when a
  domain exists, and it can be tried now on `*.localhost`.

**Open.** Whether "what is covered" is generated from the rate card and rules (right, needs care) or written per program (cheap, can
drift). CASL wording needs a lawyer before a real launch.
