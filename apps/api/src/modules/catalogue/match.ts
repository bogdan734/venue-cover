import { type Kysely, sql } from 'kysely';
import type { Database } from '../../db/types.js';
import type { ActivityMatch, RiskClass } from '../../domain/types.js';
import { type Embedder, toVectorLiteral } from './embedder.js';

// Score = 0.6 x cosine similarity of embeddings + 0.4 x trigram word similarity. A best score under the floor means
// "not in the catalogue". Both numbers come from the evals (evals/README.md), not from taste.
export const MATCH_FLOOR = 0.4;

const BATCH = 64;

// Embeds the activities that have no vector yet, or whose vector another model made. Returns how many it embedded.
export async function embedCatalogue(db: Kysely<Database>, embedder: Embedder): Promise<number> {
  const rows = await db
    .selectFrom('activity')
    .select(['id', 'search_text'])
    .where((eb) =>
      eb.or([eb('embedding', 'is', null), eb('embedding_model', 'is distinct from', embedder.id)]),
    )
    .execute();
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const vectors = await embedder.embed(
      chunk.map((r) => r.search_text),
      'passage',
    );
    await db.transaction().execute(async (trx) => {
      for (const [j, row] of chunk.entries()) {
        const vector = vectors[j] as number[];
        await trx
          .updateTable('activity')
          .set({ embedding: toVectorLiteral(vector), embedding_model: embedder.id })
          .where('id', '=', row.id)
          .execute();
      }
    });
  }
  return rows.length;
}

// The catalogue is small, so every row is scored exactly; the HNSW and trigram indexes are there for when it grows.
export async function matchActivities(
  db: Kysely<Database>,
  phrases: string[],
  embedder: Embedder,
  k: number,
): Promise<ActivityMatch[][]> {
  if (phrases.length === 0) return [];
  const { floor, ceiling, weight } = embedder.scale;
  if (!(ceiling > floor) || !(weight >= 0 && weight <= 1)) {
    throw new RangeError(
      `the scale of ${embedder.id} needs floor < ceiling and a weight from 0 to 1`,
    );
  }
  const vectors = await embedder.embed(phrases, 'query');
  return Promise.all(
    phrases.map(async (phrase, i) => {
      const vector = toVectorLiteral(vectors[i] as number[]);
      const { rows } = await sql<{
        id: string;
        title: string;
        risk_class: RiskClass;
        score: number;
      }>`
        select id, title, risk_class,
          ${weight}::float8
              * greatest(0::float8, least(1::float8,
                  ((1 - (embedding <=> ${vector}::vector)) - ${floor}::float8) / ${ceiling - floor}::float8))
            + ${1 - weight}::float8 * word_similarity(${phrase}, search_text) as score
        from activity
        where embedding is not null
        order by score desc
        limit ${k}`.execute(db);
      return rows.map((r) => ({
        activityId: r.id,
        title: r.title,
        riskClass: r.risk_class,
        score: Number(r.score),
        phrase,
      }));
    }),
  );
}
