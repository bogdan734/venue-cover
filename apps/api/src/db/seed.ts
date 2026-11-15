import type { Kysely } from 'kysely';
import type { SeedData } from '../../../../data/generate.js';
import type { Database } from './types.js';

const CHUNK = 500;

async function insertChunked<T>(rows: readonly T[], insert: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += CHUNK) await insert(rows.slice(i, i + CHUNK));
}

// Loads generated data into an empty, migrated database in dependency order.
export async function seedDatabase(db: Kysely<Database>, data: SeedData): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await trx.insertInto('broker').values(data.brokers).execute();
    await trx
      .insertInto('program')
      .values(
        data.programs.map((p) => ({
          id: p.id,
          code: p.code,
          name: p.name,
          province: p.province,
          broker_id: p.brokerId,
          loading_bps: p.loadingBps,
          commission_bps: p.commissionBps,
          fee_cents: p.feeCents,
          theme: JSON.stringify(p.theme),
          contacts: JSON.stringify(p.contacts),
        })),
      )
      .execute();
    await trx
      .insertInto('venue')
      .values(
        data.venues.map((v) => ({
          id: v.id,
          program_id: v.programId,
          name: v.name,
          municipality: v.municipality,
          contact_email: v.contactEmail,
        })),
      )
      .execute();
    await trx
      .insertInto('rental')
      .values(
        data.rentals.map((r) => ({ program_id: r.programId, ref: r.ref, venue_id: r.venueId })),
      )
      .execute();
    await trx
      .insertInto('coverage_product')
      .values(
        data.products.map((p) => ({ id: p.id, code: p.code, name: p.name, max_hours: p.maxHours })),
      )
      .execute();
    await insertChunked(data.activities, (chunk) =>
      trx
        .insertInto('activity')
        .values(
          chunk.map((a) => ({
            id: a.id,
            product_id: a.productId,
            title: a.title,
            risk_class: a.riskClass,
            aliases: a.aliases,
            search_text: a.searchText,
            embedding: null,
          })),
        )
        .execute(),
    );
    await insertChunked(data.rateRows, (chunk) =>
      trx
        .insertInto('rate_row')
        .values(
          chunk.map((r) => ({
            id: r.id,
            product_id: r.productId,
            risk_class: r.riskClass,
            limit_cents: r.limitCents,
            alcohol: r.alcohol,
            participants_min: r.participantsMin,
            participants_max: r.participantsMax,
            net_cents_per_hour: r.netCentsPerHour,
            effective_from: r.effectiveFrom,
            effective_to: r.effectiveTo,
          })),
        )
        .execute(),
    );
    await trx
      .insertInto('program_rules')
      .values(
        data.programRules.map((r) => ({
          id: r.id,
          program_id: r.programId,
          version: r.version,
          effective_from: r.effectiveFrom,
          rules: JSON.stringify(r.rules),
        })),
      )
      .execute();
    await trx
      .insertInto('sanctions_entry')
      .values(data.sanctions.map((s) => ({ id: s.id, name: s.name, list_name: s.listName })))
      .execute();
  });
}
