import type { EventHandler } from './modules/events/index.js';
import { createCertificateHandler } from './modules/policies/index.js';
import { quoteEventHandler } from './modules/quotes/index.js';
import { createWebhookHandler } from './modules/webhooks/index.js';
import type { MailProvider } from './providers/mail.js';

// Everything that reacts to outbox events, in one list for the relay (and for tests that drain the outbox).
export function createHandlers(deps: { mail: MailProvider; clock: () => Date }): EventHandler[] {
  return [createCertificateHandler(deps), quoteEventHandler, createWebhookHandler(deps.clock)];
}
