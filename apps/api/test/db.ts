import { randomBytes } from 'node:crypto';
import { type Kysely, sql } from 'kysely';
import { createDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import type { Database } from '../src/db/types.js';

const baseUrl =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://venue:venue@localhost:54329/venue';

export interface TestDb {
  db: Kysely<Database>;
  /** The SQL of every query the application database ran; clear it to start counting. */
  queries: string[];
  drop(): Promise<void>;
}

// Every caller gets its own throwaway database, so test files can run in parallel.
export async function createTestDb(options: { migrate?: boolean } = {}): Promise<TestDb> {
  const name = `vc_test_${randomBytes(6).toString('hex')}`;
  const admin = createDb(baseUrl);
  await sql`create database ${sql.id(name)}`.execute(admin);
  await admin.destroy();

  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  const queries: string[] = [];
  const db = createDb(url.toString(), { onQuery: (sql) => queries.push(sql) });
  if (options.migrate !== false) await migrate(db);

  return {
    db,
    queries,
    async drop() {
      await db.destroy();
      const cleanup = createDb(baseUrl);
      await sql`drop database ${sql.id(name)} with (force)`.execute(cleanup);
      await cleanup.destroy();
    },
  };
}
