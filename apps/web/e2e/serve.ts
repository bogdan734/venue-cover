import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { generate } from '../../../data/generate.js';
import { seedDatabase } from '../../api/src/db/seed.js';
import { playHistory } from '../../api/src/demo/history.js';
import { SCOPES } from '../../api/src/domain/types.js';
import { createApiKey } from '../../api/src/modules/auth/index.js';
import {
  createLexicalEmbedder,
  createTransformersEmbedder,
  embedCatalogue,
  isModelCached,
} from '../../api/src/modules/catalogue/index.js';
import { createTelegram } from '../../api/src/modules/conversations/index.js';
import {
  createKeywordLlm,
  createRecordedLlm,
  type Recording,
} from '../../api/src/modules/intake/index.js';
import {
  createNameModel,
  createShield,
  isNameModelCached,
} from '../../api/src/modules/privacy/index.js';
import type { HttpClient } from '../../api/src/modules/webhooks/index.js';
import { startPlatform } from '../../api/src/platform.js';
import { SimulatedMail } from '../../api/src/providers/mail.js';
import { SimulatedPayments } from '../../api/src/providers/payments.js';
import { createTestDb } from '../../api/test/db.js';

// The whole product on one machine, from nothing: a fresh database with the invented data, the API with the demo
// model, and the web app in front of it. The end-to-end tests run against this, and `npm run demo` is the same thing
// left running. Stopping it removes the database.
//
//   WEB_PORT (3100), API_PORT (3101), EMBEDDER=lexical|transformers, WEB_MODE=dev|start (dev)

const webPort = Number(process.env.WEB_PORT ?? 3100);
const apiPort = Number(process.env.API_PORT ?? 3101);
const webDir = fileURLToPath(new URL('..', import.meta.url));

// Nobody listens for webhooks here, so the address says how its receiver behaves: a path with "gone" refuses for
// good (410), "down" fails and is retried (503), "flaky" refuses the first time and accepts after, anything else accepts.
const attempts = new Map<string, number>();
const receivers: HttpClient = {
  async post(url) {
    if (url.includes('gone')) return { status: 410 };
    if (url.includes('down')) return { status: 503 };
    if (url.includes('flaky')) {
      const n = (attempts.get(url) ?? 0) + 1;
      attempts.set(url, n);
      return { status: n === 1 ? 410 : 200 };
    }
    return { status: 200 };
  },
};

const database = await createTestDb();
await seedDatabase(database.db, generate(42));
// The multilingual model when it is already on this machine, the offline embedder otherwise; EMBEDDER decides when set.
const multilingual = process.env.EMBEDDER
  ? process.env.EMBEDDER === 'transformers'
  : isModelCached();
const embedder = multilingual ? await createTransformersEmbedder() : createLexicalEmbedder();
await embedCatalogue(database.db, embedder);

// Names: the local model when it is on disk; NAMES decides when set (the tests use rules, the same on every machine).
// The secret lives as long as this database: both are made fresh on every start.
const modelNames = process.env.NAMES ? process.env.NAMES === 'model' : isNameModelCached();
const shield = createShield({
  secret: randomBytes(32).toString('base64url'),
  ...(modelNames ? { names: await createNameModel() } : {}),
});

// The demo's Telegram bot, when its token is set (`npm run public` reads it from .env.public). The tests never set it: a
// bot token can be long-polled by one process at a time.
const telegram = process.env.TELEGRAM_BOT_TOKEN
  ? await createTelegram({ token: process.env.TELEGRAM_BOT_TOKEN, fetch: globalThis.fetch })
  : undefined;

const recording = JSON.parse(
  readFileSync(new URL('../../../evals/recordings/ollama.json', import.meta.url), 'utf8'),
) as Recording;
// The clock the services and the simulated payment provider read. The demo's history sets it in the past while it plays.
let pretend: Date | null = null;
const clock = () => pretend ?? new Date();

const api = startPlatform({
  db: database.db,
  payments: new SimulatedPayments(),
  mail: new SimulatedMail(),
  http: receivers,
  llm: createRecordedLlm(recording, createKeywordLlm()),
  embedder,
  shield,
  clock,
  pollMs: { relay: 150, deliveries: 250 },
  ...(telegram ? { telegram } : {}),
  // Where the bot opens the portals inside Telegram: the public demo's https address (`npm run public`).
  ...(process.env.PUBLIC_URL?.startsWith('https://') ? { webAppUrl: process.env.PUBLIC_URL } : {}),
});
// The public demo opens on a month of invented business (DEMO_HISTORY_DAYS); the tests start from nothing.
const historyDays = Number(process.env.DEMO_HISTORY_DAYS ?? 0);
if (historyDays > 0) {
  const played = await playHistory(
    { app: api, db: database.db, setClock: (at) => (pretend = at) },
    { days: historyDays, seed: 2026 },
  );
  console.log(
    `history: ${played.days} days, ${played.visits} visitors, ${played.quotes} quotes, ${played.policies} policies, ${played.claims} claims, ${played.conversations} chats`,
  );
}
await api.listen({ port: apiPort, host: '127.0.0.1' });
const operator = await createApiKey(database.db, {
  name: 'web',
  programId: null,
  scopes: [...SCOPES],
});

// Node 22.11 cannot require() the ES-only packages the CSS toolchain uses; 22.12 and later can.
const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
const nodeOptions =
  major === 22 && minor < 12
    ? `${process.env.NODE_OPTIONS ?? ''} --experimental-require-module --no-warnings`
    : process.env.NODE_OPTIONS;

const next = spawn(
  process.execPath,
  [
    createRequire(import.meta.url).resolve('next/dist/bin/next'),
    process.env.WEB_MODE === 'start' ? 'start' : 'dev',
    '--port',
    String(webPort),
    // This machine only: from outside, the way in is the tunnel, whose headers say who the visitor is.
    '--hostname',
    '127.0.0.1',
  ],
  {
    cwd: webDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      ...(nodeOptions ? { NODE_OPTIONS: nodeOptions } : {}),
      VENUE_API_URL: `http://127.0.0.1:${apiPort}`,
      VENUE_OPERATOR_KEY: operator.key,
    },
  },
);
console.log(
  `api on http://127.0.0.1:${apiPort}, web on http://127.0.0.1:${webPort}, embedder ${embedder.id}, names by ${shield.finder}${telegram ? `, Telegram as @${telegram.username}` : ''}`,
);

let stopping = false;
async function stop(code: number): Promise<void> {
  if (stopping) return;
  stopping = true;
  next.kill('SIGTERM');
  await api.close();
  await database.drop();
  process.exit(code);
}
next.on('exit', (code) => void stop(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => void stop(0));
