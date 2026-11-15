import { type Kysely, sql } from 'kysely';
import type { Database } from '../../db/types.js';
import type { ScreeningResult } from '../../domain/types.js';

// Trigram similarity from 0 to 1. Below this a name is treated as clear; at or above it a person must look.
export const SCREEN_THRESHOLD = 0.6;

export async function screenName(db: Kysely<Database>, name: string): Promise<ScreeningResult> {
  const { rows } = await sql<{ id: string; score: number }>`
    select id, similarity(name, ${name}) as score from sanctions_entry order by score desc limit 1`.execute(
    db,
  );
  const top = rows[0];
  if (!top) return { match: false, score: 0, entryId: null };
  const score = Number(top.score);
  const match = score >= SCREEN_THRESHOLD;
  return { match, score, entryId: match ? top.id : null };
}
