import type { Kysely, Selectable } from 'kysely';
import type { Database } from '../../db/types.js';
import type { PolicySnapshot } from '../../domain/types.js';
import { HttpError } from '../../http/errors.js';
import type { Principal } from '../auth/index.js';

export interface PolicyView {
  id: string;
  programId: string;
  quoteId: string;
  policyNumber: string;
  startsAt: string;
  endsAt: string;
  totalCents: number;
  issuedAt: string;
  snapshot: PolicySnapshot;
}

type PolicyRow = Selectable<Database['policy']>;

function toView(row: PolicyRow): PolicyView {
  return {
    id: row.id,
    programId: row.program_id,
    quoteId: row.quote_id,
    policyNumber: row.policy_number,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    totalCents: row.total_cents,
    issuedAt: row.issued_at.toISOString(),
    snapshot: row.snapshot as PolicySnapshot,
  };
}

export async function getPolicyView(
  db: Kysely<Database>,
  id: string,
): Promise<PolicyView | undefined> {
  const row = await db.selectFrom('policy').selectAll().where('id', '=', id).executeTakeFirst();
  return row ? toView(row) : undefined;
}

// A program key sees its own program's policies; a key without a program sees all.
export async function getPolicyFor(
  db: Kysely<Database>,
  p: Principal,
  id: string,
): Promise<PolicyView> {
  const view = await getPolicyView(db, id);
  if (!view || (p.programId !== null && p.programId !== view.programId)) {
    throw new HttpError(404, 'policy_not_found', `no policy ${id}`);
  }
  return view;
}

// The policies issued for a set of quotes, keyed by quote id.
export async function getPoliciesByQuote(
  db: Kysely<Database>,
  quoteIds: string[],
): Promise<Map<string, PolicyView>> {
  const out = new Map<string, PolicyView>();
  if (quoteIds.length === 0) return out;
  const rows = await db
    .selectFrom('policy')
    .selectAll()
    .where('quote_id', 'in', [...new Set(quoteIds)])
    .execute();
  for (const row of rows) out.set(row.quote_id, toView(row));
  return out;
}

// The policies issued in [from, to), oldest first; one program's, or every program's when none is named.
export async function listPoliciesIssued(
  db: Kysely<Database>,
  range: { from: Date; to: Date },
  programId?: string,
): Promise<PolicyView[]> {
  let query = db
    .selectFrom('policy')
    .selectAll()
    .where('issued_at', '>=', range.from)
    .where('issued_at', '<', range.to);
  if (programId) query = query.where('program_id', '=', programId);
  const rows = await query.orderBy('issued_at').orderBy('policy_number').execute();
  return rows.map(toView);
}
