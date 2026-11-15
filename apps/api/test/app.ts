import type { FastifyInstance } from 'fastify';
import { generate } from '../../../data/generate.js';
import { seedDatabase } from '../src/db/seed.js';
import type { Scope } from '../src/domain/types.js';
import { createHandlers } from '../src/handlers.js';
import { createApiKey } from '../src/modules/auth/index.js';
import { createLexicalEmbedder, embedCatalogue } from '../src/modules/catalogue/index.js';
import { drainOutbox } from '../src/modules/events/index.js';
import { createFakeLlm, type LlmRequest } from '../src/modules/intake/index.js';
import { createShield } from '../src/modules/privacy/index.js';
import { deliverDue } from '../src/modules/webhooks/index.js';
import { SimulatedMail } from '../src/providers/mail.js';
import { SimulatedPayments } from '../src/providers/payments.js';
import { buildServer } from '../src/server.js';
import { createTestDb, type TestDb } from './db.js';
import { RecordingHttp } from './http.js';

export const NOW = new Date('2026-11-13T12:00:00.000Z');
export const TEST_PRIVACY_SECRET = 'a test secret that is long enough';

export interface TestApp extends TestDb {
  app: FastifyInstance;
  payments: SimulatedPayments;
  mail: SimulatedMail;
  http: RecordingHttp;
  /** Sends the webhook deliveries that are due at the test clock; returns how many were attempted. */
  deliver(): Promise<number>;
  /** Runs the outbox handlers until nothing is left, like the relay would. */
  drain(): Promise<void>;
  now: { value: Date };
  /** What the fake model answers; a test replaces `handler`. */
  llm: { handler: (request: LlmRequest) => unknown };
  keyFor(programId: string | null, scopes: Scope[]): Promise<string>;
  /** Quotes and binds a birthday party for the program, as a renter would; returns what was made. */
  bindPolicy(
    programId: string,
    over?: { eventDate?: string; startTime?: string; hours?: number; paymentToken?: string },
  ): Promise<{ quoteId: string; policyId: string; policyNumber: string }>;
  activityId(title: string): Promise<string>;
  close(): Promise<void>;
}

// A seeded database with embedded activities, a server with a controllable clock, a simulated payment provider
// and a scripted model.
export async function createTestApp(): Promise<TestApp> {
  const t = await createTestDb();
  await seedDatabase(t.db, generate(42));
  const embedder = createLexicalEmbedder();
  await embedCatalogue(t.db, embedder);
  const now = { value: NOW };
  let bound = 0;
  const payments = new SimulatedPayments();
  const mail = new SimulatedMail();
  const http = new RecordingHttp();
  const llm = {
    handler: (_request: LlmRequest): unknown => {
      throw new Error('the model was called but this test did not script it');
    },
  };
  const app = buildServer({
    db: t.db,
    payments,
    mail,
    llm: createFakeLlm((request) => llm.handler(request)),
    embedder,
    shield: createShield({ secret: TEST_PRIVACY_SECRET }),
    clock: () => now.value,
  });
  await app.ready();
  return {
    ...t,
    app,
    payments,
    mail,
    async drain() {
      while ((await drainOutbox(t.db, createHandlers({ mail, clock: () => now.value }), 100)) > 0);
    },
    http,
    deliver: () => deliverDue(t.db, http, now.value, { rand: () => 1 }),
    now,
    llm,
    async keyFor(programId, scopes) {
      return (await createApiKey(t.db, { name: 'test', programId, scopes })).key;
    },
    async bindPolicy(programId, over = {}) {
      const key = (
        await createApiKey(t.db, {
          name: 'renter',
          programId,
          scopes: ['quotes:read', 'quotes:write'],
        })
      ).key;
      const send = async (url: string, payload: object) =>
        (
          await app.inject({
            method: 'POST',
            url,
            headers: { authorization: `Bearer ${key}`, 'idempotency-key': `bind-${++bound}` },
            payload,
          })
        ).json();
      const activity = await t.db
        .selectFrom('activity')
        .select('id')
        .where('title', '=', 'Birthday party')
        .executeTakeFirstOrThrow();
      const quote = await send('/v1/quotes', {
        activityId: activity.id,
        participants: 40,
        hours: over.hours ?? 4,
        alcohol: 'none',
        eventDate: over.eventDate ?? '2026-12-20',
        startTime: over.startTime ?? '18:00',
        limitCents: 200_000_000,
        holder: { name: `Pat ${bound}`, email: 'pat@example.org' },
      });
      const policy = await send(`/v1/quotes/${quote.id}/bind`, {
        paymentToken: over.paymentToken ?? 'tok_ok',
      });
      return { quoteId: quote.id, policyId: policy.policyId, policyNumber: policy.policyNumber };
    },
    async activityId(title) {
      const row = await t.db
        .selectFrom('activity')
        .select('id')
        .where('title', '=', title)
        .executeTakeFirstOrThrow();
      return row.id;
    },
    async close() {
      await app.close();
      await t.drop();
    },
  };
}
