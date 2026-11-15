import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDb } from './db/client.js';
import {
  createLexicalEmbedder,
  createTransformersEmbedder,
  type Embedder,
  embedCatalogue,
} from './modules/catalogue/index.js';
import { createTelegram } from './modules/conversations/index.js';
import {
  createAnthropicLlm,
  createKeywordLlm,
  createOllamaLlm,
  createRecordedLlm,
  type LlmProvider,
  type Recording,
} from './modules/intake/index.js';
import {
  createNameModel,
  createShield,
  isNameModelCached,
  type Shield,
} from './modules/privacy/index.js';
import { createFetchClient } from './modules/webhooks/index.js';
import { startPlatform } from './platform.js';
import { SimulatedMail } from './providers/mail.js';
import { SimulatedPayments } from './providers/payments.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required (see .env.example)`);
  return value;
}

// The answers a local model gave to the demo's examples and to the evaluation set.
const DEMO_RECORDING = fileURLToPath(
  new URL('../../../evals/recordings/ollama.json', import.meta.url),
);

function llmFromEnv(): LlmProvider {
  const provider = required('LLM_PROVIDER');
  if (provider === 'demo') {
    // No model and no key: a recorded answer where there is one, the plain keyword reader for any other text.
    const file = process.env.DEMO_RECORDING ?? DEMO_RECORDING;
    return createRecordedLlm(
      JSON.parse(readFileSync(file, 'utf8')) as Recording,
      createKeywordLlm(),
    );
  }
  if (provider === 'ollama') {
    return createOllamaLlm({
      model: process.env.OLLAMA_MODEL ?? 'qwen2.5:14b',
      baseUrl: process.env.OLLAMA_URL,
    });
  }
  if (provider === 'anthropic') {
    return createAnthropicLlm({
      apiKey: required('ANTHROPIC_API_KEY'),
      model: required('ANTHROPIC_MODEL'),
    });
  }
  throw new Error(`LLM_PROVIDER must be demo, ollama or anthropic, got ${provider}`);
}

// Names are found by the local model when it is on disk; NAMES=model insists on it (downloading it once), NAMES=rules
// never uses it.
async function shieldFromEnv(): Promise<Shield> {
  const cache = process.env.MODEL_CACHE ? { cacheDir: process.env.MODEL_CACHE } : {};
  const names = process.env.NAMES ?? (isNameModelCached(cache.cacheDir) ? 'model' : 'rules');
  if (names !== 'model' && names !== 'rules') {
    throw new Error(`NAMES must be model or rules, got ${names}`);
  }
  return createShield({
    secret: required('PRIVACY_SECRET'),
    ...(names === 'model' ? { names: await createNameModel(cache) } : {}),
  });
}

function embedderFromEnv(): Promise<Embedder> {
  const kind = process.env.EMBEDDER ?? 'lexical';
  if (kind === 'lexical') return Promise.resolve(createLexicalEmbedder());
  if (kind === 'transformers') {
    return createTransformersEmbedder(
      process.env.MODEL_CACHE ? { cacheDir: process.env.MODEL_CACHE } : {},
    );
  }
  throw new Error(`EMBEDDER must be lexical or transformers, got ${kind}`);
}

const db = createDb(required('DATABASE_URL'));
const embedder = await embedderFromEnv();
const shield = await shieldFromEnv();
// Activities seeded without a vector, or with one from another model, are embedded before the first request.
const embedded = await embedCatalogue(db, embedder);
if (embedded > 0) console.log(`embedded ${embedded} activities with ${embedder.id}`);
// A renter can also write to the program in Telegram when a bot token is given.
const telegram = process.env.TELEGRAM_BOT_TOKEN
  ? await createTelegram({ token: process.env.TELEGRAM_BOT_TOKEN, fetch: globalThis.fetch })
  : undefined;
const app = startPlatform({
  db,
  payments: new SimulatedPayments(),
  mail: new SimulatedMail(),
  http: createFetchClient(),
  llm: llmFromEnv(),
  embedder,
  shield,
  clock: () => new Date(),
  ...(process.env.PUBLIC_WEB_URL ? { publicWebUrl: process.env.PUBLIC_WEB_URL } : {}),
  ...(process.env.PUBLIC_WEB_URL?.startsWith('https://')
    ? { webAppUrl: process.env.PUBLIC_WEB_URL }
    : {}),
  ...(telegram ? { telegram } : {}),
});
const port = Number(process.env.PORT ?? 3000);

// Closing the server stops the workers; only then is the database pool released.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void app.close().then(() => db.destroy()));
}
// This machine only, unless HOST says otherwise (a container sets 0.0.0.0): the web app is the way in from outside.
await app.listen({ port, host: process.env.HOST ?? '127.0.0.1' });
