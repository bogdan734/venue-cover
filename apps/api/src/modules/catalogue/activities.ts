import type { Kysely } from 'kysely';
import type { Database } from '../../db/types.js';
import type { RiskClass } from '../../domain/types.js';

export interface ActivityView {
  id: string;
  title: string;
  riskClass: RiskClass;
  product: { id: string; code: string; maxHours: number };
}

async function load(db: Kysely<Database>, ids: string[]): Promise<ActivityView[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .selectFrom('activity')
    .innerJoin('coverage_product', 'coverage_product.id', 'activity.product_id')
    .select([
      'activity.id',
      'activity.title',
      'activity.risk_class',
      'coverage_product.id as product_id',
      'coverage_product.code',
      'coverage_product.max_hours',
    ])
    .where('activity.id', 'in', ids)
    .execute();
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    riskClass: row.risk_class,
    product: { id: row.product_id, code: row.code, maxHours: row.max_hours },
  }));
}

export async function getActivity(
  db: Kysely<Database>,
  id: string,
): Promise<ActivityView | undefined> {
  return (await load(db, [id]))[0];
}

export async function getActivities(
  db: Kysely<Database>,
  ids: string[],
): Promise<Map<string, ActivityView>> {
  return new Map((await load(db, [...new Set(ids)])).map((a) => [a.id, a]));
}
