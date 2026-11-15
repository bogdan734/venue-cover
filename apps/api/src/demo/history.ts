import type { FastifyInstance } from 'fastify';
import { type Kysely, sql } from 'kysely';
import { createRng } from '../../../../data/prng.js';
import { GOLDEN, type GoldenCase } from '../../../../evals/golden.js';
import type { Database } from '../db/types.js';
import { SCOPES } from '../domain/types.js';
import { createApiKey } from '../modules/auth/index.js';

// A month of invented business on the three demo portals, made the way real business is made: through the API, with a
// clock set in the past. A renter describes an event, gets a price or a referral, pays with a simulated card; an
// underwriter decides; a few report a loss; some ask the chat. Afterwards every row written during a step is moved to the
// step's time, so the hub and the policy list agree with each other, as they would after a
// real month. Nothing here is real, and the README says so.

export interface HistoryDeps {
  /** A server whose clock (and whose simulated payment provider's clock) follows `setClock`. */
  app: FastifyInstance;
  db: Kysely<Database>;
  /** Moves the server's clock; null puts it back to real time. */
  setClock(at: Date | null): void;
}

export interface HistoryReport {
  days: number;
  visits: number;
  quotes: number;
  policies: number;
  referralsOpen: number;
  claims: number;
  conversations: number;
}

interface Profile {
  /** Visitors on a weekday, low and high. */
  visitors: [number, number];
  weekend: number;
  /** Share of visitors who describe an event. */
  describe: number;
  /** Share of priced quotes that are paid for. */
  pay: number;
  /** Share of descriptions that are plain enough to be priced on the spot. */
  plain: number;
  cases: (c: GoldenCase) => boolean;
  /** A few days of extra visitors, as after a newsletter. */
  spike?: { daysAgo: number; length: number; factor: number };
}

// Three different clients: a busy municipal portal where most events are priced on the spot, a school board whose rules
// send more to an underwriter, and halls in Quebec where many renters write in French and a newsletter brought a rush.
const PROFILES: Record<string, Profile> = {
  FHV: {
    visitors: [55, 105],
    weekend: 1.4,
    describe: 0.07,
    pay: 0.68,
    plain: 0.85,
    cases: (c) => !c.tags.some((t) => t === 'french' || t === 'injection' || t === 'personal'),
  },
  RVT: {
    visitors: [16, 40],
    weekend: 0.5,
    describe: 0.09,
    pay: 0.55,
    plain: 0.5,
    cases: (c) => !c.tags.some((t) => t === 'french' || t === 'injection' || t === 'personal'),
  },
  SAB: {
    visitors: [24, 55],
    weekend: 1.2,
    describe: 0.08,
    pay: 0.62,
    plain: 0.7,
    cases: (c) => !c.tags.some((t) => t === 'injection' || t === 'personal'),
    spike: { daysAgo: 16, length: 3, factor: 2.8 },
  },
};

const FIRST = [
  'Amira',
  'Lucas',
  'Chloé',
  'Noah',
  'Priya',
  'Mateo',
  'Hannah',
  'Owen',
  'Léa',
  'Ravi',
  'Grace',
  'Tomás',
  'Mei',
  'Liam',
  'Zoé',
  'Samuel',
  'Aaliyah',
  'Ethan',
  'Sofia',
  'Jonah',
];
const LAST = [
  'Tremblay',
  'Singh',
  'MacLeod',
  'Gagnon',
  'Okafor',
  'Chen',
  'Roy',
  'Haddad',
  'Wilson',
  'Côté',
  'Nguyen',
  'Bouchard',
  'Patel',
  'Martin',
  'Kowalski',
  'Ferreira',
];
const STARTS = ['10:00', '12:30', '14:00', '17:00', '18:30', '19:00'];
const APPROVE = [
  'Checked the crowd size and the venue; the standard terms are fine.',
  'Alcohol is served by a licensed caterer with its own cover; approved.',
  'Spoke to the organiser: marshals at the exits, first aid on site. Approved.',
];
const DECLINE = [
  'Outside this program: open flame and pyrotechnics are excluded.',
  'Too large for a hall rental; this needs a special-event policy.',
];
const LOSSES = [
  'A guest slipped on a wet floor near the entrance and hurt a wrist; first aid was given and they went to a clinic.',
  'A folding table collapsed during set-up and scratched the hall floor; the venue sent photos.',
  'A child fell from the bouncy castle and was checked by paramedics, no fracture.',
];
// What renters ask in the chat, and how the office answers when the assistant hands it over.
const CHATS: { ask: string; staff?: string }[] = [
  { ask: 'Is alcohol covered at a wedding reception?' },
  { ask: 'How much would a birthday party for 40 people cost?' },
  { ask: 'Where is my certificate? The venue needs it before Friday.' },
  {
    ask: 'Can I cancel my booking and get a refund?',
    staff:
      'I have passed it to the booking office; you will get an e-mail about the refund within two working days.',
  },
  {
    ask: 'Someone tripped over a cable on the stage during our concert. What do I do?',
    staff:
      'Sorry to hear it. I have opened a claim and an adjuster will call you tomorrow morning.',
  },
  {
    ask: 'I need to talk to a person about a festival with about 2000 people.',
    staff:
      'Thanks for writing. An event that size needs a special-event policy; I will call you this afternoon.',
  },
];

// The tables whose times are written by the database, not by the clock the services are given.
const STAMPED: [keyof Database, string][] = [
  ['quote', 'created_at'],
  ['classification', 'created_at'],
  ['referral', 'created_at'],
  ['policy', 'issued_at'],
  ['claim', 'created_at'],
  ['outbox_event', 'occurred_at'],
  ['message', 'at'],
  ['conversation', 'created_at'],
  ['audit_log', 'at'],
];

const DAY = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export async function playHistory(
  deps: HistoryDeps,
  options: { days: number; seed: number; until?: Date },
): Promise<HistoryReport> {
  const rng = createRng(options.seed);
  const until = options.until ?? new Date();
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rng() * list.length)] as T;
  const between = (low: number, high: number) => low + Math.floor(rng() * (high - low + 1));
  const report: HistoryReport = {
    days: options.days,
    visits: 0,
    quotes: 0,
    policies: 0,
    referralsOpen: 0,
    claims: 0,
    conversations: 0,
  };

  const made = await createApiKey(deps.db, {
    name: 'underwriting desk',
    programId: null,
    scopes: [...SCOPES],
  });
  const keys = [made];
  const programs = await deps.db
    .selectFrom('program')
    .select(['id', 'code'])
    .where('code', 'in', Object.keys(PROFILES))
    .execute();
  const portal = new Map<string, string>();
  for (const p of programs) {
    const key = await createApiKey(deps.db, {
      name: 'web portal',
      programId: p.id,
      scopes: ['quotes:read', 'quotes:write', 'personal:read'],
    });
    keys.push(key);
    portal.set(p.id, key.key);
  }
  let counter = 0;
  const call = async (
    method: 'GET' | 'POST',
    url: string,
    key: string,
    payload?: object,
    headers: Record<string, string> = {},
  ) => {
    const res = await deps.app.inject({
      method,
      url,
      headers: {
        authorization: `Bearer ${key}`,
        ...(method === 'POST' ? { 'idempotency-key': `history-${options.seed}-${++counter}` } : {}),
        ...headers,
      },
      ...(payload ? { payload } : {}),
    });
    if (res.statusCode >= 500)
      throw new Error(`${method} ${url} answered ${res.statusCode}: ${res.body}`);
    return res;
  };

  // Runs `step` with the server's clock at `at`, then moves what the database stamped during it to that time.
  async function at<T>(when: Date, step: () => Promise<T>): Promise<T> {
    deps.setClock(when);
    const { rows } = await sql<{ t: Date }>`select clock_timestamp() as t`.execute(deps.db);
    const started = rows[0]?.t as Date;
    const result = await step();
    const back = (started.getTime() - when.getTime()) / 1000;
    for (const [table, column] of STAMPED) {
      await sql`update ${sql.table(table)} set ${sql.ref(column)} = ${sql.ref(column)} - make_interval(secs => ${back}) where ${sql.ref(column)} >= ${started}`.execute(
        deps.db,
      );
    }
    return result;
  }

  const rulesOf = new Map<string, number[]>();
  for (const p of programs) {
    const detail = (await call('GET', `/v1/programs/${p.id}`, made.key)).json();
    rulesOf.set(p.id, detail.rules.limitsCents);
  }

  const bound: {
    policyId: string;
    programId: string;
    eventDate: string;
    holder: { name: string; email: string };
  }[] = [];

  async function pay(
    quoteId: string,
    programId: string,
    when: Date,
    eventDate: string,
    holder: { name: string; email: string },
  ) {
    const res = await at(when, () =>
      call('POST', `/v1/quotes/${quoteId}/bind`, portal.get(programId) as string, {
        paymentToken: 'tok_ok',
      }),
    );
    if (res.statusCode === 201 || res.statusCode === 200) {
      report.policies++;
      bound.push({ policyId: res.json().policyId, programId, eventDate, holder });
    }
  }

  for (let daysAgo = options.days; daysAgo >= 1; daysAgo--) {
    const day = new Date(until.getTime() - daysAgo * DAY);
    const weekend = [0, 6].includes(day.getUTCDay());
    for (const program of programs) {
      const profile = PROFILES[program.code] as Profile;
      const key = portal.get(program.id) as string;
      const spike =
        profile.spike &&
        daysAgo <= profile.spike.daysAgo &&
        daysAgo > profile.spike.daysAgo - profile.spike.length;
      const visitors = Math.round(
        between(...profile.visitors) *
          (weekend ? profile.weekend : 1) *
          (spike ? (profile.spike?.factor ?? 1) : 1),
      );
      await deps.db
        .insertInto('portal_visit')
        .values({ program_id: program.id, day: isoDay(day), visitors })
        .onConflict((oc) => oc.columns(['program_id', 'day']).doUpdateSet({ visitors }))
        .execute();
      report.visits += visitors;

      const cases = GOLDEN.filter(profile.cases);
      const plain = cases.filter((c) => c.outcome === 'auto');
      const hard = cases.filter((c) => c.outcome === 'refer');
      const describing = Math.max(1, Math.round(visitors * profile.describe));
      for (let n = 0; n < describing; n++) {
        const when = new Date(day.getTime() + between(8 * 60, 22 * 60) * 60_000);
        const story = pick(rng() < profile.plain ? plain : hard);
        const classified = await at(when, () =>
          call('POST', '/v1/intake/classify', key, { text: story.text }),
        );
        if (classified.statusCode !== 200) continue;
        const c = classified.json();
        if (!c.primary) continue; // nothing in the catalogue fits: the renter goes elsewhere
        const first = pick(FIRST);
        const last = pick(LAST);
        const holder = {
          name: `${first} ${last}`,
          email: `${first}.${last}`
            .normalize('NFD')
            .replace(/[^A-Za-z.]/g, '')
            .toLowerCase()
            .concat('@example.org'),
        };
        const eventDate = isoDay(new Date(when.getTime() + between(4, 45) * DAY));
        const limits = rulesOf.get(program.id) ?? [200_000_000];
        const quoted = await at(new Date(when.getTime() + 3 * 60_000), () =>
          call('POST', '/v1/quotes', key, {
            classificationId: c.id,
            activityId: c.primary.activityId,
            participants: c.facts.participants ?? between(20, 160),
            hours: c.facts.hours ?? between(2, 6),
            alcohol: c.facts.alcohol ?? 'none',
            eventDate,
            startTime: pick(STARTS),
            limitCents: rng() < 0.8 ? limits[0] : (limits.at(-1) ?? limits[0]),
            holder,
          }),
        );
        if (quoted.statusCode !== 201) continue;
        report.quotes++;
        const quote = quoted.json();

        if (quote.state === 'quoted' && rng() < profile.pay) {
          await pay(
            quote.id,
            program.id,
            new Date(when.getTime() + between(5, 90) * 60_000),
            eventDate,
            holder,
          );
        } else if (quote.state === 'referred') {
          const referral = await deps.db
            .selectFrom('referral')
            .select('id')
            .where('quote_id', '=', quote.id)
            .executeTakeFirst();
          const decidedAt = new Date(when.getTime() + between(2, 26) * 3_600_000);
          if (!referral || decidedAt.getTime() > until.getTime() - DAY) {
            report.referralsOpen++;
            continue;
          }
          const wanted = rng() < 0.7;
          // A referral with no price is priced by hand, as class C. What the rate card cannot price at all is declined,
          // as an underwriter would: it needs a special-event policy.
          const approved = await at(decidedAt, async () => {
            await call('POST', `/v1/referrals/${referral.id}/claim`, made.key);
            const decide = (body: object) =>
              call('POST', `/v1/referrals/${referral.id}/decision`, made.key, body);
            if (wanted) {
              const unpriced = quote.premium === null;
              const approval = await decide({
                action: unpriced ? 'approve_with_override' : 'approve',
                ...(unpriced ? { riskClass: 'C' } : {}),
                note: unpriced
                  ? 'Priced by hand as class C after a call with the organiser.'
                  : pick(APPROVE),
              });
              if (approval.statusCode === 200) return true;
              if (approval.json().error?.code !== 'no_rate') {
                throw new Error(`a history approval was refused: ${approval.body}`);
              }
            }
            const declined = await decide({
              action: 'decline',
              note: wanted
                ? 'The rate card cannot price this combination; it needs a special-event policy.'
                : pick(DECLINE),
            });
            if (declined.statusCode !== 200) {
              throw new Error(`a history decline was refused: ${declined.body}`);
            }
            return false;
          });
          if (approved && rng() < profile.pay) {
            await pay(
              quote.id,
              program.id,
              new Date(decidedAt.getTime() + between(1, 20) * 3_600_000),
              eventDate,
              holder,
            );
          }
        }
      }

      // Now and then a renter asks the chat; what the assistant hands over, the office answers the next day.
      if (rng() < 0.3) {
        const chat = pick(CHATS);
        const when = new Date(day.getTime() + between(9 * 60, 21 * 60) * 60_000);
        const opened = await at(when, () => call('POST', '/v1/conversations', key, {}));
        const conversation = opened.json();
        const said = await at(new Date(when.getTime() + 60_000), () =>
          call(
            'POST',
            `/v1/conversations/${conversation.id}/messages`,
            key,
            { text: chat.ask },
            { 'conversation-key': conversation.key },
          ),
        );
        report.conversations++;
        if (said.json().state === 'waiting' && chat.staff && daysAgo > 1) {
          const reply = new Date(when.getTime() + between(2, 20) * 3_600_000);
          await at(reply, async () => {
            await call('POST', `/v1/inbox/${conversation.id}/messages`, made.key, {
              text: chat.staff,
            });
            await call('POST', `/v1/inbox/${conversation.id}/state`, made.key, { to: 'closed' });
          });
        }
      }
    }
  }

  // A few events that have happened had a loss, reported a day or two after.
  for (const policy of bound) {
    const lossDay = new Date(`${policy.eventDate}T20:00:00Z`);
    const reported = new Date(lossDay.getTime() + between(1, 2) * DAY);
    if (reported.getTime() > until.getTime() || rng() > 0.06) continue;
    const res = await at(reported, () =>
      call('POST', '/v1/claims', portal.get(policy.programId) as string, {
        policyId: policy.policyId,
        lossDate: policy.eventDate,
        description: pick(LOSSES),
        reporter: policy.holder,
      }),
    );
    if (res.statusCode === 201) report.claims++;
  }

  deps.setClock(null);
  // The keys were the history's own: its requests are not anyone's to read, and the keys stop working.
  const ids = keys.map((k) => k.id);
  await deps.db.deleteFrom('request_log').where('key_id', 'in', ids).execute();
  await deps.db
    .updateTable('api_key')
    .set({ revoked_at: new Date() })
    .where('id', 'in', ids)
    .execute();
  return report;
}
