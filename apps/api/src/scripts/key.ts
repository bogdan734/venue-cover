import { createDb } from '../db/client.js';
import { SCOPES, type Scope } from '../domain/types.js';
import { createApiKey } from '../modules/auth/index.js';

// Prints a new API key once. The first operator key has to come from here, because issuing keys over the API needs one.
//   npm run key -w apps/api -- --name web --scopes programs:manage,quotes:read [--program prg_1]
const args = process.argv.slice(2);
const value = (name: string) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
};

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required (see .env.example)');
const name = value('name');
const scopes = (value('scopes') ?? '').split(',').filter(Boolean);
const unknown = scopes.filter((scope) => !(SCOPES as readonly string[]).includes(scope));
if (!name || scopes.length === 0 || unknown.length > 0) {
  throw new Error(`usage: --name <name> --scopes <${SCOPES.join(',')}> [--program <id>]`);
}

const db = createDb(databaseUrl);
try {
  const { id, key } = await createApiKey(db, {
    name,
    programId: value('program') ?? null,
    scopes: scopes as Scope[],
  });
  console.log(`${id} ${key}`);
} finally {
  await db.destroy();
}
