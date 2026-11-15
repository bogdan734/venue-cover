import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generate } from '../../../../data/generate.js';
import { createTestDb, type TestDb } from '../../test/db.js';
import { seedDatabase } from './seed.js';

let t: TestDb;
const data = generate(42);
beforeAll(async () => {
  t = await createTestDb();
  await seedDatabase(t.db, data);
});
afterAll(async () => {
  await t.drop();
});

describe('seed', () => {
  it('loads every generated row with all foreign keys satisfied', async () => {
    const count = async (
      table: 'activity' | 'rate_row' | 'venue' | 'program_rules' | 'sanctions_entry',
    ) =>
      Number(
        (
          await t.db
            .selectFrom(table)
            .select((eb) => eb.fn.countAll<string>().as('n'))
            .executeTakeFirstOrThrow()
        ).n,
      );
    expect(await count('activity')).toBe(data.activities.length);
    expect(await count('rate_row')).toBe(data.rateRows.length);
    expect(await count('venue')).toBe(data.venues.length);
    expect(await count('program_rules')).toBe(data.programRules.length);
    expect(await count('sanctions_entry')).toBe(data.sanctions.length);
  });

  it('returns date columns as plain strings', async () => {
    const row = await t.db
      .selectFrom('rate_row')
      .select('effective_from')
      .executeTakeFirstOrThrow();
    expect(row.effective_from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('stores program rules as JSON that reads back as an object', async () => {
    const row = await t.db
      .selectFrom('program_rules')
      .select('rules')
      .where('program_id', '=', 'prg_1')
      .executeTakeFirstOrThrow();
    expect(row.rules).toMatchObject({ autoMaxClass: 'B', alcoholAuto: true });
  });
});
