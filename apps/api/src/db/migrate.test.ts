import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../../test/db.js';
import { migrate } from './migrate.js';

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb({ migrate: false });
});
afterAll(async () => {
  await t.drop();
});

describe('migrations', () => {
  it('apply to an empty database and are idempotent', async () => {
    expect(await migrate(t.db)).toEqual([
      '0001_init.sql',
      '0002_renters.sql',
      '0003_privacy.sql',
      '0004_pseudonyms.sql',
      '0005_tenants.sql',
      '0006_conversations.sql',
      '0007_client_access.sql',
      '0008_request_log.sql',
    ]); // in name order
    expect(await migrate(t.db)).toEqual([]);

    const tables = await sql<{ n: string }>`
      select count(*)::text as n from information_schema.tables where table_schema = 'public'`.execute(
      t.db,
    );
    expect(Number(tables.rows[0]?.n)).toBeGreaterThanOrEqual(19);
    const ext = await sql<{ extname: string }>`
      select extname from pg_extension where extname in ('vector', 'pg_trgm') order by extname`.execute(
      t.db,
    );
    expect(ext.rows.map((r) => r.extname)).toEqual(['pg_trgm', 'vector']);
  });
});
