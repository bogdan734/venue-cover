import { getActivities } from '../modules/catalogue/index.js';
import { getPoliciesByQuote } from '../modules/policies/index.js';
import { getPrograms } from '../modules/programs/index.js';
import { referralsByQuote } from '../modules/quotes/index.js';
import type { ServerDeps } from '../server.js';
import type { GqlContext } from './context.js';

type Query<T> = { obj: T };

// Fields that need another table are resolved for a whole list at once: a list of 50 quotes costs one query for their
// programs, one for their activities, one for their policies and one for their referrals, not 200.
export function buildLoaders(deps: ServerDeps) {
  const { db, clock } = deps;
  return {
    Quote: {
      async program(queries: Query<{ programId: string }>[]) {
        const map = await getPrograms(
          db,
          queries.map((q) => q.obj.programId),
        );
        return queries.map((q) => map.get(q.obj.programId) ?? null);
      },
      async activity(queries: Query<{ activityId: string }>[]) {
        const map = await getActivities(
          db,
          queries.map((q) => q.obj.activityId),
        );
        return queries.map((q) => map.get(q.obj.activityId) ?? null);
      },
      async policy(queries: Query<{ id: string }>[]) {
        const map = await getPoliciesByQuote(
          db,
          queries.map((q) => q.obj.id),
        );
        return queries.map((q) => map.get(q.obj.id) ?? null);
      },
      async referral(queries: Query<{ id: string }>[], ctx: GqlContext) {
        const map = await referralsByQuote(
          db,
          ctx.principal,
          queries.map((q) => q.obj.id),
          clock(),
        );
        return queries.map((q) => map.get(q.obj.id) ?? null);
      },
    },
    Policy: {
      async program(queries: Query<{ programId: string }>[]) {
        const map = await getPrograms(
          db,
          queries.map((q) => q.obj.programId),
        );
        return queries.map((q) => map.get(q.obj.programId) ?? null);
      },
    },
  };
}
