import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generate } from '../../../../../data/generate.js';
import { createTestDb, type TestDb } from '../../../test/db.js';
import { seedDatabase } from '../../db/seed.js';
import { createLexicalEmbedder, embedCatalogue, MATCH_FLOOR, matchActivities } from './index.js';

let t: TestDb;
const embedder = createLexicalEmbedder();
const data = generate(42);

beforeAll(async () => {
  t = await createTestDb();
  await seedDatabase(t.db, data);
  await embedCatalogue(t.db, embedder);
});
afterAll(() => t.drop());

const top = async (phrase: string) => {
  const [matches] = await matchActivities(t.db, [phrase], embedder, 3);
  return matches ?? [];
};

describe('embedCatalogue', () => {
  it('embeds every activity once and is idempotent', async () => {
    const missing = await t.db
      .selectFrom('activity')
      .select('id')
      .where('embedding', 'is', null)
      .execute();
    expect(missing).toEqual([]);
    expect(await embedCatalogue(t.db, embedder)).toBe(0);
  });

  it('embeds again what another model embedded, and says which model made each vector', async () => {
    const other = { ...createLexicalEmbedder(), id: 'another-model' };
    expect(await embedCatalogue(t.db, other)).toBe(data.activities.length);
    expect(await embedCatalogue(t.db, other)).toBe(0);
    const models = await t.db.selectFrom('activity').select('embedding_model').distinct().execute();
    expect(models).toEqual([{ embedding_model: 'another-model' }]);
    expect(await embedCatalogue(t.db, embedder)).toBe(data.activities.length); // and back
  });
});

describe('matchActivities', () => {
  it('puts an exact title first for every activity', async () => {
    const wrong: string[] = [];
    const phrases = data.activities.map((a) => a.title);
    const all = await matchActivities(t.db, phrases, embedder, 1);
    all.forEach((matches, i) => {
      if (matches[0]?.title !== phrases[i]) wrong.push(`${phrases[i]} -> ${matches[0]?.title}`);
    });
    // Titles that are a substring of a longer title ("Pilates", "Pilates instructor") may swap places; allow a few.
    expect(wrong.length).toBeLessThanOrEqual(5);
  });

  it('matches a typo and an alias', async () => {
    expect((await top('birthdy party'))[0]?.title).toBe('Birthday party');
    expect((await top('bday party'))[0]?.title).toBe('Birthday party');
    expect((await top('inflatable party'))[0]?.title).toBe('Bouncy castle party');
    expect((await top('fun run for charity'))[0]?.title).toBe('Fun run');
  });

  it('returns scored matches in descending order with the phrase attached', async () => {
    const matches = await top('yoga class');
    expect(matches).toHaveLength(3);
    expect(matches.map((m) => m.score)).toEqual(
      [...matches.map((m) => m.score)].sort((a, b) => b - a),
    );
    expect(matches[0]).toMatchObject({ phrase: 'yoga class', riskClass: 'A' });
  });

  it('scores an unknown activity below the floor', async () => {
    for (const phrase of [
      'quarterly tax filing for chickens',
      'underwater basket negotiation',
      'zxqv wplk',
    ]) {
      expect((await top(phrase))[0]?.score ?? 0).toBeLessThan(MATCH_FLOOR);
    }
  });

  it('scores a real activity above the floor', async () => {
    for (const phrase of ['birthday party', 'hockey game', 'food truck', 'wedding reception']) {
      expect((await top(phrase))[0]?.score ?? 0).toBeGreaterThan(MATCH_FLOOR);
    }
  });
});

describe('the scale of a model', () => {
  // The lexical embedder with another reading of its cosines: what a model whose unrelated texts already score 0.3
  // and whose same-activity pairs score 0.6 would need.
  const scaled = (scale: { floor: number; ceiling: number; weight: number }) => ({
    ...embedder,
    scale,
  });
  const score = async (e: typeof embedder, phrase: string) =>
    (await matchActivities(t.db, [phrase], e, 1))[0]?.[0]?.score ?? 0;

  it('turns a cosine between the floor and the ceiling into a score between 0 and 1', async () => {
    const e = scaled({ floor: 0.3, ceiling: 0.6, weight: 1 });
    expect(await score(e, 'yoga class')).toBeGreaterThan(0.95); // at or above the ceiling
    expect(await score(e, 'zxqv wplk')).toBe(0); // below the floor, not negative
    const middle = await score(e, 'yoga clas for kids');
    expect(middle).toBeGreaterThan(0);
    expect(middle).toBeLessThanOrEqual(1);
  });

  it('refuses a scale that cannot be applied', async () => {
    for (const scale of [
      { floor: 0.8, ceiling: 0.8, weight: 0.5 },
      { floor: 0.9, ceiling: 0.8, weight: 0.5 },
      { floor: 0, ceiling: 1, weight: 1.2 },
      { floor: 0, ceiling: 1, weight: -0.1 },
    ]) {
      await expect(score(scaled(scale), 'yoga class'), JSON.stringify(scale)).rejects.toThrow(
        RangeError,
      );
    }
  });

  it('shares the score between the vector and the spelling by its weight', async () => {
    const spelling = scaled({ floor: 0, ceiling: 1, weight: 0 });
    const vector = scaled({ floor: 0, ceiling: 1, weight: 1 });
    // "yogaa clas": the trigrams are close to "Yoga class", the vector less so
    const phrase = 'yogaa clas';
    const [a, b] = [await score(spelling, phrase), await score(vector, phrase)];
    expect(a).not.toBeCloseTo(b, 2);
    const blend = await score(scaled({ floor: 0, ceiling: 1, weight: 0.5 }), phrase);
    expect(blend).toBeCloseTo((a + b) / 2, 2);
  });
});
