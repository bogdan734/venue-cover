import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generate } from '../../../../../data/generate.js';
import { createTestDb, type TestDb } from '../../../test/db.js';
import { seedDatabase } from '../../db/seed.js';
import { type Embedder, embedCatalogue, MATCH_FLOOR, matchActivities } from './index.js';
import { createTransformersEmbedder, isModelCached } from './transformers.js';

// The model is about 120 MB and comes from the Hugging Face hub, so this suite runs when it is already in the cache
// (or when DOWNLOAD_MODEL=1 allows fetching it) and is skipped everywhere else, such as a clean CI machine.
const available = isModelCached() || process.env.DOWNLOAD_MODEL === '1';

const cosine = (a: number[], b: number[]) => a.reduce((sum, x, i) => sum + x * (b[i] ?? 0), 0);

describe.skipIf(!available)('the multilingual embedder', () => {
  let embedder: Embedder;
  let t: TestDb;

  beforeAll(async () => {
    embedder = await createTransformersEmbedder();
    t = await createTestDb();
    await seedDatabase(t.db, generate(42));
    await embedCatalogue(t.db, embedder);
  }, 600_000);
  afterAll(() => t?.drop());

  it('returns unit vectors of the size the database column holds', async () => {
    const [vector] = await embedder.embed(['fireworks display'], 'passage');
    expect(vector).toHaveLength(384);
    expect(Math.hypot(...(vector ?? []))).toBeCloseTo(1, 4);
  });

  it('puts a query and a passage of the same text in slightly different places', async () => {
    const [query] = await embedder.embed(['yoga class'], 'query');
    const [passage] = await embedder.embed(['yoga class'], 'passage');
    expect(cosine(query ?? [], passage ?? [])).toBeLessThan(0.9999);
  });

  it('knows what the words mean, in English and in French', async () => {
    const passages = await embedder.embed(['Fireworks display', 'Yoga class'], 'passage');
    for (const phrase of ['rockets and bangers at night', "feu d'artifice"]) {
      const [query] = await embedder.embed([phrase], 'query');
      expect(cosine(query ?? [], passages[0] ?? []), phrase).toBeGreaterThan(
        cosine(query ?? [], passages[1] ?? []),
      );
    }
  });

  it('finds a French description in the English catalogue, and does not pretend to find one it cannot place', async () => {
    const phrases = [
      'cours de yoga',
      'tournoi de hockey',
      'spectacle de pyrotechnie',
      "feu d'artifice",
    ];
    const [yoga, hockey, show, idiom] = await matchActivities(t.db, phrases, embedder, 3);
    expect(yoga?.[0]?.title).toBe('Yoga class');
    expect(hockey?.[0]?.title).toBe('Ice hockey game');
    expect(show?.map((m) => m.title)).toContain('Fireworks display');
    // A short idiom that the small model cannot place scores low, so a person sees it, instead of landing on a wrong
    // activity with confidence.
    expect(idiom?.[0]?.score ?? 0).toBeLessThan(0.6);
  });

  it('scores a title near 1 and a phrase that is not an activity below the match floor', async () => {
    const real = await matchActivities(
      t.db,
      ['Yoga class', 'Birthday party', 'Ice hockey game'],
      embedder,
      1,
    );
    for (const [matches] of real.map((m) => [m]))
      expect(matches?.[0]?.score ?? 0).toBeGreaterThan(0.9);
    const none = await matchActivities(
      t.db,
      ['quarterly tax filing for chickens', 'underwater basket negotiation', 'zxqv wplk'],
      embedder,
      1,
    );
    for (const matches of none) expect(matches[0]?.score ?? 0).toBeLessThan(MATCH_FLOOR);
  });
});
