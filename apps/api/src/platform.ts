import type { FastifyInstance } from 'fastify';
import { createHandlers } from './handlers.js';
import { BOT_PROFILE, handleTelegram } from './modules/conversations/index.js';
import { startRelay } from './modules/events/index.js';
import { guardLlm } from './modules/privacy/index.js';
import { type HttpClient, startDeliveryWorker } from './modules/webhooks/index.js';
import { buildServer, type ServerDeps } from './server.js';

export interface PlatformDeps extends ServerDeps {
  /** What webhook deliveries are sent with. */
  http: HttpClient;
  /** How often the outbox relay and the delivery worker look for work, in milliseconds. */
  pollMs?: { relay: number; deliveries: number };
}

// The whole service in one process: the HTTP server, the outbox relay that runs event handlers, and the worker that
// sends webhooks. Closing the server stops the two workers first, so nothing is left half-done.
export function startPlatform(deps: PlatformDeps): FastifyInstance {
  const app = buildServer(deps);
  const poll = deps.pollMs ?? { relay: 500, deliveries: 1000 };
  const relay = startRelay(deps.db, createHandlers({ mail: deps.mail, clock: deps.clock }), {
    intervalMs: poll.relay,
    batch: 50,
    onError: (error) => console.error('outbox relay:', error),
  });
  const deliveries = startDeliveryWorker(deps.db, deps.http, {
    intervalMs: poll.deliveries,
    clock: deps.clock,
    onError: (error) => console.error('webhook delivery:', error),
  });
  // Telegram is long-polled, so no address on this machine has to be reachable. Its model calls go through a guard of
  // their own: the bot already sends protected text, and the guard strips whatever slipped past.
  const chatDeps = { ...deps, llm: guardLlm(deps.llm, deps.shield.detect).llm };
  // What the bot says about itself (its description and commands) is set from here, so it always matches the code; the menu
  // button beside every chat opens the portals inside Telegram.
  const logged = (what: string) => (error: unknown) =>
    console.error(`telegram ${what}:`, error instanceof Error ? error.message : error);
  deps.telegram?.setProfile(BOT_PROFILE).catch(logged('profile'));
  if (deps.telegram && deps.webAppUrl) {
    deps.telegram
      .setMenu({ label: 'Get covered', url: `${deps.webAppUrl}/portals` })
      .catch(logged('menu'));
  }
  const telegram = deps.telegram?.start(
    (message) => handleTelegram(chatDeps, message),
    (error) => console.error('telegram:', error instanceof Error ? error.message : error),
  );
  app.addHook('onClose', async () => {
    await telegram?.stop();
    await relay.stop();
    await deliveries.stop();
  });
  return app;
}
