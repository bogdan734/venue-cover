import { RegisterBody, ResendBody, SignInBody, VerifyBody } from '../modules/accounts/index.js';
import { ApiKeyBody } from '../modules/auth/index.js';
import { ClaimNotice } from '../modules/claims/index.js';
import { ConversationStateBody, MessageBody } from '../modules/conversations/index.js';
import { ClassifyBody, QuestionsBody } from '../modules/intake/index.js';
import { BindBody, QuoteBody, UnderwriterDecision } from '../modules/quotes/index.js';
import { DraftBody, PreviewBody, ProgramBody, PublishBody } from '../modules/setup/index.js';
import {
  AccessBody,
  ContactsBody,
  ResolveBody,
  StatusBody,
  ThemeBody,
} from '../modules/tenants/index.js';
import { EndpointBody } from '../modules/webhooks/index.js';
import { MailboxClaim } from './mailbox.js';
import type { OperationDoc } from './openapi.js';

// The description of every /v1 route, written by hand: what it is for, which key may call it, whether it needs an
// Idempotency-Key. The request schemas come from the same zod schemas the routes validate with, so they cannot drift.
// A test fails when a route has no entry here, or an entry here has no route.
export const OPERATIONS: Record<string, OperationDoc> = {
  'GET /v1/me': {
    summary: 'Who this API key is',
    description: 'The key id, the program it is bound to and its scopes.',
  },
  'POST /v1/api-keys': {
    summary: 'Issue an API key for a program',
    description:
      'For a key without a program. The new key is bound to the program and can hold only scopes the issuing key holds. The secret is returned once and only its hash is stored, so this call takes no Idempotency-Key.',
    scope: 'programs:manage',
    body: ApiKeyBody,
    success: 201,
  },
  'GET /v1/openapi.json': { summary: 'This document' },
  'GET /v1/request-log': {
    summary: 'Recent requests made with your keys',
    description:
      'Newest first: key, method, route template, status and milliseconds. A program’s key reads its program’s requests; a key without a program reads all. Addresses are not kept, only route templates, because ids and queries can hold personal details.',
    query: { limit: '1 to 200, default 50' },
  },
  'GET /v1/events/stream': {
    summary: 'Live feed of events (server-sent events)',
    description:
      'One frame per event: id is the sequence number, event is the type, data is the event as JSON. Starts at the live end; send Last-Event-ID to resume. A program key sees its own program only.',
    scope: 'quotes:read',
    produces: 'text/event-stream',
  },

  'POST /v1/renters': {
    summary: 'Open a renter account',
    description:
      'Sends a confirmation link to the address. The answer is the same whether or not the address already has an account; only the e-mail says which. Needs a program’s key: the link points at that program’s portal.',
    scope: 'quotes:write',
    body: RegisterBody,
    success: 202,
  },
  'POST /v1/renters/verification': {
    summary: 'Send the confirmation link again',
    description:
      'Answers alike for any address; at most three links per half hour reach one account.',
    scope: 'quotes:write',
    body: ResendBody,
    success: 202,
  },
  'POST /v1/renters/verify': {
    summary: 'Confirm an address and sign in',
    description:
      'The link works once and for 30 minutes. Returns a session token for the Renter-Session header.',
    scope: 'quotes:write',
    body: VerifyBody,
  },
  'POST /v1/renters/sessions': {
    summary: 'Sign a renter in',
    description:
      'Returns a session token for the Renter-Session header. Five wrong passwords lock the account for 15 minutes; an unknown address and a wrong password get the same answer.',
    scope: 'quotes:write',
    body: SignInBody,
  },
  'DELETE /v1/renters/sessions/current': {
    summary: 'Sign the renter out',
    description: 'Ends the session named in the Renter-Session header.',
    scope: 'quotes:write',
    success: 204,
  },
  'GET /v1/renters/me': { summary: 'The signed-in renter', scope: 'quotes:read' },
  'GET /v1/renters/me/quotes': {
    summary: 'The signed-in renter’s quotes and policies',
    description:
      'Across every program, newest first. A quote made or paid for with a session belongs to that renter.',
    scope: 'quotes:read',
  },
  'POST /v1/demo/mailboxes': {
    summary: 'Claim the demo mailbox of an address',
    description:
      'Exists because no real e-mail leaves the demo. Returns the one key that reads the address’s simulated mail; only the first claim succeeds (409 mailbox_taken after that). For a key without a program that holds mail:read.',
    scope: 'mail:read',
    body: MailboxClaim,
    success: 201,
  },
  'GET /v1/demo/mailbox': {
    summary: 'What the simulated mail sent to one address',
    description:
      'Newest first, for the holder of the address’s mailbox key in the Mailbox-Key header. For a key without a program that holds mail:read.',
    scope: 'mail:read',
    query: { to: 'the address' },
  },

  'POST /v1/intake/classify': {
    summary: 'Read a free-text description of an event',
    description:
      'Extracts the facts (activities, crowd, hours, alcohol, hazards), matches each activity to the catalogue and returns the classification with the decision the program rules would take. Safe to repeat, so it takes no Idempotency-Key.',
    scope: 'quotes:write',
    body: ClassifyBody,
  },
  'GET /v1/intake/classifications/:id': {
    summary: 'Read a classification back',
    description:
      'What was understood from a description, each phrase with its nearest activities, and the decision today’s rules take. `maskedText` has personal details as tags (what the model saw); `text` is the description as written for a key with personal:read, and null for any other key when something was hidden.',
    scope: 'quotes:read',
  },
  'POST /v1/intake/questions': {
    summary: 'The follow-up questions still worth asking',
    description:
      "Only the program's questions that apply to this event and are not answered yet, with the answers the description already gives. Send confirmed with what the customer has corrected (activity, crowd, hours, alcohol) to get the questions a quote would be checked against.",
    scope: 'quotes:write',
    body: QuestionsBody,
  },
  'GET /v1/activity-titles': {
    summary: 'Names for activity ids',
    description: 'Up to 50 ids, comma separated; ids that do not exist are left out.',
    scope: 'quotes:read',
    query: { ids: 'comma separated activity ids' },
  },
  'GET /v1/activities': {
    summary: 'Search the activity catalogue',
    scope: 'quotes:read',
    query: { q: 'what to look for' },
  },

  'POST /v1/quotes': {
    summary: 'Create a quote',
    description:
      'Prices the event from the rate card and the program terms, or refers it to an underwriter with the reasons. A referred quote keeps an indicative price. The holder may be given as the [NAME#…] and [EMAIL#…] tags this program handed out for a person (an agent quoting for someone it knows only by tag); the quote is made with the values they stand for, and an unknown tag is refused (unknown_tag).',
    scope: 'quotes:write',
    idempotent: true,
    body: QuoteBody,
    success: 201,
  },
  'GET /v1/quotes/:id': { summary: 'Read a quote', scope: 'quotes:read' },
  'GET /v1/quotes/:id/policy': {
    summary: 'The policy a quote became',
    description: 'Answers 404 with policy_not_found until the quote has been paid for.',
    scope: 'quotes:read',
  },
  'POST /v1/quotes/:id/bind': {
    summary: 'Pay for a quote and issue the policy',
    description:
      'Charges with the quote id as the reference, issues the policy number and queues the certificates.',
    scope: 'quotes:write',
    idempotent: true,
    body: BindBody,
  },

  'GET /v1/policies/:id': { summary: 'Read a policy', scope: 'quotes:read' },
  'GET /v1/policies/:id/certificates/:holder': {
    summary: 'The certificate of insurance for one party',
    description:
      'holder is insured, venue or broker. The venue and broker certificates exist only when the booking reference identified the rental. A certificate names people, so it also needs personal:read.',
    scope: 'quotes:read',
    produces: 'application/pdf',
  },

  'POST /v1/claims': {
    summary: 'Report a loss on a policy',
    description:
      'A first notice of loss: the day it happened (it must fall in the policy period), what happened and who is reporting. Subscribers to claim.reported are told the claim and policy ids and the date, not the description or the reporter.',
    scope: 'quotes:write',
    idempotent: true,
    body: ClaimNotice,
    success: 201,
  },
  'GET /v1/claims/:id': { summary: 'Read a claim notice', scope: 'quotes:read' },

  'GET /v1/reports/policies': {
    summary: 'The policies issued in a month',
    description:
      'Every policy issued in the month (UTC) with its premium parts, a summary by limit that is computed from those lines. A key bound to a program gets that program; a key without one may name a program or take them all. format=csv returns the lines as a spreadsheet; text that would run as a formula is made plain text.',
    scope: 'reports:read',
    query: {
      month: 'YYYY-MM',
      programId: 'one program (keys without a program only)',
      format: 'json (default) or csv',
    },
  },
  'GET /v1/reports/shadow': {
    summary: 'Would the automation have made the calls people made?',
    description:
      'Reruns the classifier and the program rules on the description of every referral decided since a date (default: 30 days), without storing anything, and compares the outcome with the human decision: agreement with intervals, the share that would now be priced without a person, and the disagreements with both answers. Needs a key without a program.',
    scope: 'reports:read',
    query: { since: 'YYYY-MM-DD' },
  },
  'GET /v1/privacy': {
    summary: 'How personal details are kept from the model',
    description:
      'What finds names (the local model, or cue rules when it is not on disk) and what the guard on the model has seen since the server started: the calls it checked and how many details it had to strip because a call site had not protected its text (zero when every call site does).',
    scope: 'reports:read',
  },

  'GET /v1/referrals': {
    summary: 'The referral queue',
    description: 'Open and claimed by default; state selects another.',
    scope: 'referrals:decide',
    query: { state: 'open, claimed or decided' },
  },
  'GET /v1/referrals/:id': {
    summary: 'One referral with its classification',
    scope: 'referrals:decide',
  },
  'GET /v1/referrals/:id/worksheet': {
    summary: "The underwriter's pricing worksheet",
    description:
      'The rate card premium plus one line per risk factor with its basis, the premium that results, and the nearest past decisions.',
    scope: 'referrals:decide',
  },
  'POST /v1/referrals/:id/claim': {
    summary: 'Take a referral',
    description: 'Only one underwriter can hold a referral; repeating the claim is harmless.',
    scope: 'referrals:decide',
  },
  'POST /v1/referrals/:id/decision': {
    summary: 'Approve, approve with an override, or decline',
    scope: 'referrals:decide',
    idempotent: true,
    body: UnderwriterDecision,
  },

  'POST /v1/submissions': {
    summary: 'Send a large-event application form',
    description:
      'A fillable PDF in a part named form, plus supporting documents in parts named risk_plan, security_protocol, site_map, venue_contract and security_contract. A complete application becomes a quote for an underwriter; an incomplete one returns what is missing and a draft reply.',
    scope: 'quotes:write',
    idempotent: true,
    body: 'multipart',
    success: 201,
  },
  'GET /v1/submissions/:id': { summary: 'Read a submission', scope: 'quotes:read' },

  'POST /v1/webhook-endpoints': {
    summary: 'Register a webhook endpoint',
    description:
      'The signing secret is returned once. Registrations without https, with credentials, or pointing at a private address are refused.',
    scope: 'webhooks:manage',
    body: EndpointBody,
    success: 201,
  },
  'GET /v1/webhook-endpoints': { summary: 'List webhook endpoints', scope: 'webhooks:manage' },
  'DELETE /v1/webhook-endpoints/:id': {
    summary: 'Deactivate a webhook endpoint',
    scope: 'webhooks:manage',
    success: 204,
  },
  'GET /v1/webhook-deliveries': {
    summary: 'Recent webhook deliveries',
    scope: 'webhooks:manage',
    query: { endpointId: 'only this endpoint', state: 'pending, delivered or dead' },
  },
  'POST /v1/webhook-endpoints/:id/test': {
    summary: 'Send a test event to one endpoint',
    description:
      'A signed `webhook.test` event, delivered and retried like any other, to this endpoint only. Use it to check a receiver and its signature check.',
    scope: 'webhooks:manage',
    idempotent: true,
    success: 202,
  },
  'POST /v1/webhook-deliveries/:id/replay': {
    summary: 'Send a delivery again with the same event id',
    scope: 'webhooks:manage',
  },

  'POST /v1/programs': {
    summary: 'Create a client program from a template',
    description:
      'The template supplies terms and rules; overrides are laid over them. The program starts as a draft. Takes a key that is not bound to a program.',
    scope: 'programs:manage',
    idempotent: true,
    body: ProgramBody,
    success: 201,
  },
  'GET /v1/programs': {
    summary: 'List programs',
    description: 'Every program for a key without one; its own program for a key bound to one.',
    scope: 'programs:manage',
  },
  'GET /v1/program-options': {
    summary: 'What a new program can be made from',
    description: 'The templates with their terms and rules, and the brokers.',
    scope: 'programs:manage',
  },
  'GET /v1/programs/:id': {
    summary: 'A program with the rules in force today and every version',
    scope: 'programs:manage',
  },
  'POST /v1/programs/:id/rules': {
    summary: 'Publish a change to the rules from a date',
    description: 'Names only what changes. Versions go in date order and are never edited.',
    scope: 'programs:manage',
    idempotent: true,
    body: PublishBody,
    success: 201,
  },
  'POST /v1/programs/:id/rules/draft': {
    summary: 'Draft rule changes from written requirements',
    description:
      'Read-only: returns proposed changes, notes on each, and what could not be mapped. Nothing is published.',
    scope: 'programs:manage',
    body: DraftBody,
  },
  'POST /v1/programs/:id/rules/preview': {
    summary: 'Try a rule change on recent quotes',
    description: 'Which of the last quotes would have been decided differently. Changes nothing.',
    scope: 'programs:manage',
    body: PreviewBody,
  },

  'PUT /v1/programs/:id/appearance': {
    summary: 'Set how a program’s portal looks',
    description:
      'Brand colour, logo, tagline and welcome, replaced whole. Refused with unreadable_theme when the colour cannot be read against the page (WCAG 4.5:1) or the logo is not an image held in the page.',
    scope: 'programs:manage',
    body: ThemeBody,
  },
  'PUT /v1/programs/:id/contacts': {
    summary: 'Set who a program’s renters can reach',
    description: 'The program’s support e-mail, phone, Telegram name and hours, replaced whole.',
    scope: 'programs:manage',
    body: ContactsBody,
  },
  'POST /v1/programs/:id/status': {
    summary: 'Move a program along draft, test, live and paused',
    description:
      'Draft and test portals are for staff; a paused program takes no new quotes or binds. A live program is paused, never sent back to a draft. Takes a key that is not bound to a program.',
    scope: 'programs:manage',
    idempotent: true,
    body: StatusBody,
  },
  'GET /v1/programs/:id/audit': {
    summary: 'Who changed what about a program, newest first',
    description:
      'Creation, rules, appearance, contacts and status, each with the name of the key that made the change.',
    scope: 'programs:manage',
  },
  'POST /v1/visits': {
    summary: 'Count a visitor to a program’s portal',
    description:
      'Takes a program’s key and no body. Send one Idempotency-Key per visitor and day: a repeat is answered without counting, so each visitor counts once a day without an address or cookie being stored.',
    scope: 'quotes:read',
    idempotent: true,
    success: 204,
  },
  'GET /v1/hub/clients': {
    summary: 'Every client program’s last 30 days',
    description:
      'Visitors, quotes, referrals, policies, premium and claims per program, with the referrals waiting now and a day by day series. A program’s own key gets its own row.',
    scope: 'reports:read',
  },
  'POST /v1/programs/:id/access': {
    summary: 'Make a link to a program’s client console',
    description:
      'The link opens that program’s figures, policies and conversations. Its secret is returned once; only the hash is kept. Takes a key that is not bound to a program.',
    scope: 'programs:manage',
    idempotent: true,
    body: AccessBody,
    success: 201,
  },
  'GET /v1/programs/:id/access': {
    summary: 'A program’s client console links',
    description:
      'Label, when each was made and last used, and whether it was turned off. Never the secret.',
    scope: 'programs:manage',
  },
  'POST /v1/programs/:id/access/:accessId/revoke': {
    summary: 'Turn a client console link off',
    description: 'At once: every visit asks again.',
    scope: 'programs:manage',
    idempotent: true,
  },
  'POST /v1/access/resolve': {
    summary: 'Which program a client console link opens',
    description:
      'For the web app on every visit; records when the link was last used. An unknown and a revoked link look the same (404).',
    scope: 'programs:manage',
    body: ResolveBody,
  },

  'POST /v1/conversations': {
    summary: 'Open a chat on a portal',
    description:
      'Takes a program’s key and no body. Returns the conversation, the bot’s first line and a secret: send it as Conversation-Key on every later call for this conversation. Only its hash is stored.',
    scope: 'quotes:write',
    idempotent: true,
    success: 201,
  },
  'POST /v1/conversations/:id/messages': {
    summary: 'Write in a chat',
    description:
      'Needs the Conversation-Key; a Renter-Session ties the chat to the signed-in renter. The bot answers from the program’s rules and the renter’s own policies while it has the conversation; a claim, a request for a person or a question it cannot answer hands it over with the case attached. The text is stored with personal details as tags and the originals sealed.',
    scope: 'quotes:write',
    idempotent: true,
    body: MessageBody,
    success: 201,
  },
  'GET /v1/conversations/:id': {
    summary: 'Read a chat',
    description:
      'Needs the Conversation-Key. `after` (a time) returns only newer lines, for polling.',
    scope: 'quotes:read',
    query: { after: 'ISO time of the last line already shown' },
  },
  'GET /v1/channels': {
    summary: 'Where else renters can write',
    description:
      'The Telegram bot’s name when one is connected; its start link carries the portal code.',
    scope: 'quotes:read',
  },
  'GET /v1/inbox': {
    summary: 'Every conversation, waiting ones first',
    description: 'With the program, why it was handed over and the last line.',
    scope: 'conversations:manage',
  },
  'GET /v1/inbox/:id': {
    summary: 'One conversation with its case',
    description: 'The lines and the context it was handed over with: the reason and the policy.',
    scope: 'conversations:manage',
  },
  'POST /v1/inbox/:id/messages': {
    summary: 'Answer as a person',
    description:
      'The conversation is held by a person from then on and the bot stays quiet. On Telegram the line is sent first; one that cannot be delivered is not stored.',
    scope: 'conversations:manage',
    idempotent: true,
    body: MessageBody,
    success: 201,
  },
  'POST /v1/inbox/:id/state': {
    summary: 'Take over, give back to the bot, or close',
    description: 'A closed conversation reopens with the bot when the renter writes again.',
    scope: 'conversations:manage',
    idempotent: true,
    body: ConversationStateBody,
  },
};
