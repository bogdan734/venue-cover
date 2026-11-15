import { GraphQLScalarType } from 'graphql';
import { HttpError } from '../http/errors.js';
import { matchActivities } from '../modules/catalogue/index.js';
import { classifyEvent } from '../modules/intake/index.js';
import { getPolicyFor } from '../modules/policies/index.js';
import { resolveTags } from '../modules/privacy/index.js';
import { getProgram, getProgramRules } from '../modules/programs/index.js';
import {
  BindBody,
  bindQuote,
  claimReferral,
  createQuote,
  decideReferral,
  getQuote,
  listReferrals,
  QuoteBody,
  UnderwriterDecision,
} from '../modules/quotes/index.js';
import { decide, inputFromClassification } from '../modules/underwriting/index.js';
import { type GqlContext, guarded, idempotentField, requireScope } from './context.js';

const dayOf = (now: Date) => now.toISOString().slice(0, 10);

const JSONScalar = new GraphQLScalarType({
  name: 'JSON',
  serialize: (value) => value,
  parseValue: (value) => value,
});

type Args<T> = [unknown, T, GqlContext, { path: { key: string | number } }];

export const resolvers = {
  JSON: JSONScalar,
  Query: {
    quote: guarded(async (...[, { id }, ctx]: Args<{ id: string }>) => {
      requireScope(ctx, 'quotes:read');
      return getQuote(ctx.deps.db, ctx.principal, id, ctx.deps.clock());
    }),
    policy: guarded(async (...[, { id }, ctx]: Args<{ id: string }>) => {
      requireScope(ctx, 'quotes:read');
      return getPolicyFor(ctx.deps.db, ctx.principal, id);
    }),
    referrals: guarded(
      async (...[, { state }, ctx]: Args<{ state?: 'open' | 'claimed' | 'decided' }>) => {
        requireScope(ctx, 'referrals:decide');
        return listReferrals(
          ctx.deps.db,
          ctx.principal,
          ctx.deps.clock(),
          state ? [state] : ['open', 'claimed'],
        );
      },
    ),
    activities: guarded(async (...[, { q }, ctx]: Args<{ q: string }>) => {
      requireScope(ctx, 'quotes:read');
      const [matches] = await matchActivities(
        ctx.deps.db,
        [q.slice(0, 120)],
        ctx.deps.embedder,
        10,
      );
      return matches ?? [];
    }),
    program: guarded(async (...[, { id }, ctx]: Args<{ id: string }>) => {
      requireScope(ctx, 'quotes:read');
      if (ctx.principal.programId !== null && ctx.principal.programId !== id) return null;
      return (await getProgram(ctx.deps.db, id)) ?? null;
    }),
  },
  Mutation: {
    classifyEvent: guarded(async (...[, { text }, ctx]: Args<{ text: string }>) => {
      requireScope(ctx, 'quotes:write');
      const programId = ctx.principal.programId;
      if (!programId)
        throw new HttpError(403, 'forbidden', 'the API key is not bound to a program');
      const classification = await classifyEvent(ctx.deps, {
        text: text.slice(0, 2000),
        programId,
      });
      const rules = await getProgramRules(ctx.deps.db, programId, dayOf(ctx.deps.clock()));
      const decision = decide(
        inputFromClassification(classification, { match: false, score: 0, entryId: null }),
        rules,
      );
      return { ...classification, decision };
    }),
    createQuote: guarded(
      async (...[, { input }, ctx, info]: Args<{ input: Record<string, unknown> }>) => {
        requireScope(ctx, 'quotes:write');
        const { holderName, holderEmail, ...rest } = input;
        const body = QuoteBody.parse(
          await resolveTags(ctx.deps.db, ctx.deps.shield, ctx.principal.programId, {
            ...rest,
            holder: { name: holderName, email: holderEmail },
          }),
        );
        return idempotentField(ctx, `createQuote:${String(info.path.key)}`, input, (trx) =>
          createQuote(trx, ctx.principal, body, ctx.deps.clock()),
        );
      },
    ),
    bindQuote: guarded(
      async (...[, args, ctx, info]: Args<{ id: string; paymentToken: string }>) => {
        requireScope(ctx, 'quotes:write');
        const { paymentToken } = BindBody.parse({ paymentToken: args.paymentToken });
        return idempotentField(ctx, `bindQuote:${String(info.path.key)}`, args, (trx) =>
          bindQuote(trx, ctx.principal, args.id, paymentToken, ctx.deps.payments, ctx.deps.clock()),
        );
      },
    ),
    claimReferral: guarded(async (...[, { id }, ctx]: Args<{ id: string }>) => {
      requireScope(ctx, 'referrals:decide');
      return ctx.deps.db
        .transaction()
        .execute((trx) => claimReferral(trx, ctx.principal, id, ctx.deps.clock()));
    }),
    decideReferral: guarded(
      async (...[, args, ctx, info]: Args<{ id: string; decision: Record<string, unknown> }>) => {
        requireScope(ctx, 'referrals:decide');
        const decision = UnderwriterDecision.parse(args.decision);
        return idempotentField(ctx, `decideReferral:${String(info.path.key)}`, args, (trx) =>
          decideReferral(trx, ctx.principal, args.id, decision, ctx.deps.clock()),
        );
      },
    ),
  },
  Activity: {
    // A referral carries productCode directly; an activity loaded from the catalogue nests it under product.
    productCode: (a: { productCode?: string; product?: { code: string } }) =>
      a.productCode ?? a.product?.code,
  },
  Program: {
    rules: guarded(async (...[program, , ctx]: [{ id: string }, unknown, GqlContext]) =>
      getProgramRules(ctx.deps.db, program.id, dayOf(ctx.deps.clock())),
    ),
  },
  Policy: {
    quote: guarded(async (...[policy, , ctx]: [{ quoteId: string }, unknown, GqlContext]) =>
      getQuote(ctx.deps.db, ctx.principal, policy.quoteId, ctx.deps.clock()),
    ),
  },
};
