import type { Transaction } from 'kysely';
import type { Database } from '../../db/types.js';
import { newId } from '../../domain/ids.js';
import type { RiskClass } from '../../domain/types.js';

// An underwriter's decision is also a label: this description belongs to this activity and class.
// The evals and any later tuning read them back.
export async function recordLabelledExample(
  trx: Transaction<Database>,
  example: { text: string; activityId: string; riskClass: RiskClass },
): Promise<void> {
  await trx
    .insertInto('labelled_example')
    .values({
      id: newId('lbl'),
      text: example.text,
      activity_id: example.activityId,
      risk_class: example.riskClass,
      source: 'underwriter',
    })
    .execute();
}
