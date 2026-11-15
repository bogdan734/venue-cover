import { type Kysely, sql } from 'kysely';
import type { Database } from '../../db/types.js';
import type { ProgramStatus } from '../../domain/types.js';
import { listProgramsWithBroker } from '../programs/index.js';

export interface ClientDay {
  day: string;
  visits: number;
  policies: number;
}

// One client program's last `days` days, for the hub's list. Totals run from the first day on; `daily` ends today.
export interface ClientSummary {
  program: { id: string; code: string; name: string; status: ProgramStatus; brokerName: string };
  visits: number;
  quotes: number;
  referred: number;
  policies: number;
  premiumCents: number;
  claims: number;
  /** Referrals waiting for a person now, whenever they came in. */
  openReferrals: number;
  oldestOpenAt: string | null;
  daily: ClientDay[];
}

const DAY_MS = 86_400_000;
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const utcDay = (column: string) =>
  sql<string>`to_char(${sql.ref(column)} at time zone 'UTC', 'YYYY-MM-DD')`;

function countsBy<K extends string>(rows: { key: K; n: string | number | bigint }[]) {
  return new Map(rows.map((r) => [r.key, Number(r.n)]));
}

export async function hubClients(
  db: Kysely<Database>,
  now: Date,
  days = 30,
  only?: string,
): Promise<{ since: string; clients: ClientSummary[] }> {
  const calendar = Array.from({ length: days }, (_, i) =>
    dayOf(new Date(now.getTime() - (days - 1 - i) * DAY_MS)),
  );
  const since = calendar[0] as string;
  const from = new Date(`${since}T00:00:00.000Z`);

  const [programs, visits, policies, quotes, referred, claims, open] = await Promise.all([
    listProgramsWithBroker(db),
    db
      .selectFrom('portal_visit')
      .select(['program_id', 'day', 'visitors'])
      .where('day', '>=', since)
      .execute(),
    db
      .selectFrom('policy')
      .select((eb) => [
        'program_id',
        utcDay('issued_at').as('day'),
        eb.fn.countAll<string>().as('n'),
        eb.fn.sum<string>('total_cents').as('cents'),
      ])
      .where('issued_at', '>=', from)
      .groupBy(['program_id', 'day'])
      .execute(),
    db
      .selectFrom('quote')
      .select((eb) => ['program_id as key', eb.fn.countAll<string>().as('n')])
      .where('created_at', '>=', from)
      .groupBy('program_id')
      .execute(),
    db
      .selectFrom('referral')
      .innerJoin('quote', 'quote.id', 'referral.quote_id')
      .select((eb) => ['quote.program_id as key', eb.fn.countAll<string>().as('n')])
      .where('referral.created_at', '>=', from)
      .groupBy('quote.program_id')
      .execute(),
    db
      .selectFrom('claim')
      .innerJoin('policy', 'policy.id', 'claim.policy_id')
      .select((eb) => ['policy.program_id as key', eb.fn.countAll<string>().as('n')])
      .where('claim.created_at', '>=', from)
      .groupBy('policy.program_id')
      .execute(),
    db
      .selectFrom('referral')
      .innerJoin('quote', 'quote.id', 'referral.quote_id')
      .select((eb) => [
        'quote.program_id as key',
        eb.fn.countAll<string>().as('n'),
        eb.fn.min('referral.created_at').as('oldest'),
      ])
      .where('referral.state', '!=', 'decided')
      .groupBy('quote.program_id')
      .execute(),
  ]);

  const quoteCount = countsBy(quotes);
  const referredCount = countsBy(referred);
  const claimCount = countsBy(claims);
  const openBy = new Map(open.map((r) => [r.key, r]));

  const clients = programs
    .filter((program) => only === undefined || program.id === only)
    .map((program): ClientSummary => {
      const visitsOn = new Map(
        visits.filter((v) => v.program_id === program.id).map((v) => [v.day, v.visitors]),
      );
      const mine = policies.filter((p) => p.program_id === program.id);
      const policiesOn = new Map(mine.map((p) => [p.day, Number(p.n)]));
      const waiting = openBy.get(program.id);
      return {
        program: {
          id: program.id,
          code: program.code,
          name: program.name,
          status: program.status,
          brokerName: program.brokerName,
        },
        visits: [...visitsOn.values()].reduce((a, b) => a + b, 0),
        quotes: quoteCount.get(program.id) ?? 0,
        referred: referredCount.get(program.id) ?? 0,
        policies: mine.reduce((a, p) => a + Number(p.n), 0),
        premiumCents: mine.reduce((a, p) => a + Number(p.cents), 0),
        claims: claimCount.get(program.id) ?? 0,
        openReferrals: waiting ? Number(waiting.n) : 0,
        oldestOpenAt: waiting?.oldest ? new Date(waiting.oldest).toISOString() : null,
        daily: calendar.map((day) => ({
          day,
          visits: visitsOn.get(day) ?? 0,
          policies: policiesOn.get(day) ?? 0,
        })),
      };
    });
  return { since, clients };
}
