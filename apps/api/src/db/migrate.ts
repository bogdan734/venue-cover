import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Kysely, sql } from 'kysely';
import type { Database } from './types.js';

const defaultDir = join(import.meta.dirname, '..', '..', 'migrations');
const LOCK_ID = 7236001;

// Applies the .sql files that have not run yet, each in its own transaction. Returns the names it applied.
export async function migrate(db: Kysely<Database>, dir = defaultDir): Promise<string[]> {
  await sql`create table if not exists schema_migration (
    name text primary key, applied_at timestamptz not null default now())`.execute(db);

  const applied: string[] = [];
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    await db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(${LOCK_ID})`.execute(trx);
      const done = await sql`select 1 from schema_migration where name = ${file}`.execute(trx);
      if (done.rows.length > 0) return;
      await sql.raw(readFileSync(join(dir, file), 'utf8')).execute(trx);
      await sql`insert into schema_migration (name) values (${file})`.execute(trx);
      applied.push(file);
    });
  }
  return applied;
}
