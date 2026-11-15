import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generate } from '../../../../../data/generate.js';
import { createTestDb, type TestDb } from '../../../test/db.js';
import { seedDatabase } from '../../db/seed.js';
import { screenName } from './index.js';

let t: TestDb;
const data = generate(42);
beforeAll(async () => {
  t = await createTestDb();
  await seedDatabase(t.db, data);
});
afterAll(() => t.drop());

describe('screenName', () => {
  it('matches a listed name exactly', async () => {
    const listed = data.sanctions[0];
    const result = await screenName(t.db, listed?.name ?? '');
    expect(result).toMatchObject({ match: true, entryId: listed?.id });
    expect(result.score).toBeGreaterThan(0.95);
  });

  it('matches a near spelling', async () => {
    for (const listed of data.sanctions.slice(0, 10)) {
      const typo = listed.name.slice(0, 2) + listed.name.slice(3); // one letter dropped
      expect((await screenName(t.db, typo)).match).toBe(true);
    }
  });

  it('does not match an ordinary name', async () => {
    for (const name of [
      'Pat Example',
      'Fairhaven Minor Hockey Association',
      'Maria Gonzalez-Smith',
    ]) {
      expect((await screenName(t.db, name)).match).toBe(false);
    }
  });
});
