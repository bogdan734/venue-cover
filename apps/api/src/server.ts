import Fastify, { type FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from './db/types.js';
import { registerGraphql } from './graphql/plugin.js';
import { collectApiRoutes } from './http/catalogue.js';
import { registerErrorHandling } from './http/errors.js';
import { registerMailbox } from './http/mailbox.js';
import { registerOpenApi } from './http/openapi.js';
import { registerRequestLog } from './http/request-log.js';
import { registerEventStream } from './http/stream.js';
import { registerAccountRoutes } from './modules/accounts/index.js';
import { registerAuthRoutes } from './modules/auth/index.js';
import type { Embedder } from './modules/catalogue/index.js';
import { registerClaimRoutes } from './modules/claims/index.js';
import { registerConversationRoutes, type TelegramBot } from './modules/conversations/index.js';
import { type LlmProvider, registerIntakeRoutes } from './modules/intake/index.js';
import { registerPolicyRoutes } from './modules/policies/index.js';
import {
  guardLlm,
  registerPersonalGate,
  registerPrivacyRoutes,
  type Shield,
} from './modules/privacy/index.js';
import { registerQuoteRoutes, registerReferralRoutes } from './modules/quotes/index.js';
import { registerReportRoutes } from './modules/reporting/index.js';
import { registerSetupRoutes } from './modules/setup/index.js';
import { registerShadowRoutes } from './modules/shadow/index.js';
import { registerSubmissionRoutes } from './modules/submissions/index.js';
import { registerTenantRoutes } from './modules/tenants/index.js';
import { registerWebhookRoutes } from './modules/webhooks/index.js';
import { type MailProvider, SimulatedMail } from './providers/mail.js';
import type { PaymentProvider } from './providers/payments.js';

export interface ServerDeps {
  db: Kysely<Database>;
  payments: PaymentProvider;
  llm: LlmProvider;
  embedder: Embedder;
  /** Keeps personal details from the model: protects text, holds the keys, finds what a prompt still carries. */
  shield: Shield;
  mail: MailProvider;
  clock: () => Date;
  /** The web app's address, for absolute links in e-mails. */
  publicWebUrl?: string;
  /** The Telegram bot, when one is connected: staff replies to a Telegram conversation go out through it. */
  telegram?: TelegramBot;
  /** The https address of the web app, where the bot opens the portals inside Telegram (a Mini App). */
  webAppUrl?: string;
}

export function buildServer(input: ServerDeps): FastifyInstance {
  // Every model call goes through the guard, so what a call site forgot to protect is stripped before it leaves.
  const guarded = guardLlm(input.llm, input.shield.detect);
  const deps = { ...input, llm: guarded.llm };
  const app = Fastify({ logger: false });
  // First, so that it stands in front of every route: a key without personal:read reads people as tags.
  registerPersonalGate(app, deps);
  registerErrorHandling(app);
  collectApiRoutes(app);
  app.get('/healthz', async () => ({ ok: true }));
  registerRequestLog(app, deps.db);
  registerAuthRoutes(app, deps.db);
  registerAccountRoutes(app, deps);
  if (deps.mail instanceof SimulatedMail) registerMailbox(app, deps.db, deps.mail);
  registerQuoteRoutes(app, deps);
  registerReferralRoutes(app, deps);
  registerPolicyRoutes(app, deps.db);
  registerClaimRoutes(app, deps.db);
  registerReportRoutes(app, deps.db);
  registerShadowRoutes(app, deps);
  registerWebhookRoutes(app, deps.db, deps.clock);
  registerSetupRoutes(app, deps);
  registerTenantRoutes(app, deps);
  registerConversationRoutes(app, deps);
  registerSubmissionRoutes(app, deps);
  registerGraphql(app, deps);
  registerEventStream(app, deps.db);
  registerOpenApi(app, deps.db);
  registerIntakeRoutes(app, deps);
  registerPrivacyRoutes(app, { db: deps.db, shield: deps.shield, stats: guarded.stats });
  return app;
}
