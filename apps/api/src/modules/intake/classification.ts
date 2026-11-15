import type { Kysely, Selectable } from 'kysely';
import type { Database } from '../../db/types.js';
import type { ActivityMatch, EventFacts, PhraseMatch, RiskClass } from '../../domain/types.js';
import { open, reveal, type Shield } from '../privacy/index.js';

export interface ClassificationRecord {
  id: string;
  programId: string;
  /** The description with personal details as tags: what the model saw, and what search and reports use. */
  maskedText: string;
  /** The description as written, for a reader allowed to see personal details; the same as `maskedText` when nothing
   *  was hidden; null for anyone else. */
  text: string | null;
  facts: EventFacts;
  phrases: PhraseMatch[];
  riskClass: RiskClass | null;
  confidence: number;
  degraded: boolean;
}

/** Who reads a record: the shield that holds the keys, and whether the reader may see personal details. */
export interface Reader {
  shield: Shield;
  personal: boolean;
}

function textFor(
  row: Selectable<Database['classification']>,
  reader: Reader | null,
): string | null {
  if (!row.vault) return row.masked_text;
  if (!reader?.personal) return null;
  return reveal(row.masked_text, open(row.vault, reader.shield.keys(row.program_id).seal, row.id));
}

export async function getClassificationRecord(
  db: Kysely<Database>,
  id: string,
  programId: string | null,
  reader: Reader | null = null,
): Promise<ClassificationRecord | undefined> {
  let query = db.selectFrom('classification').selectAll().where('id', '=', id);
  if (programId) query = query.where('program_id', '=', programId);
  const row = await query.executeTakeFirst();
  if (!row) return undefined;
  return {
    id: row.id,
    programId: row.program_id,
    maskedText: row.masked_text,
    text: textFor(row, reader),
    facts: row.facts as EventFacts,
    phrases: row.matches as PhraseMatch[],
    riskClass: row.risk_class,
    confidence: Number(row.confidence),
    degraded: row.degraded,
  };
}

export const CLASS_RANK: Record<RiskClass, number> = { A: 0, B: 1, C: 2, X: 3 };

// The accepted match that prices the event: highest class, then highest score.
export function primaryOf(record: Pick<ClassificationRecord, 'phrases'>): ActivityMatch | null {
  return record.phrases
    .flatMap((p) => (p.accepted ? [p.accepted] : []))
    .reduce<ActivityMatch | null>(
      (best, a) =>
        !best ||
        CLASS_RANK[a.riskClass] > CLASS_RANK[best.riskClass] ||
        (a.riskClass === best.riskClass && a.score > best.score)
          ? a
          : best,
      null,
    );
}
