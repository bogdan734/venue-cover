import { describe, expect, it } from 'vitest';
import { createDb } from './db/client.js';
import { createLexicalEmbedder } from './modules/catalogue/index.js';
import { createFakeLlm } from './modules/intake/index.js';
import { createShield } from './modules/privacy/index.js';
import { SimulatedMail } from './providers/mail.js';
import { SimulatedPayments } from './providers/payments.js';
import { buildServer } from './server.js';

describe('server', () => {
  it('healthz returns ok', async () => {
    // The pool connects lazily, so no database is needed for this route.
    const db = createDb('postgres://venue:venue@localhost:1/venue');
    const app = buildServer({
      db,
      payments: new SimulatedPayments(),
      mail: new SimulatedMail(),
      llm: createFakeLlm(() => ({})),
      embedder: createLexicalEmbedder(),
      shield: createShield({ secret: 'a test secret that is long enough' }),
      clock: () => new Date(),
    });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
    await db.destroy();
  });
});
