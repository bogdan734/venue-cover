import { createHash } from 'node:crypto';
import {
  acceptedContent,
  type CallToolResult,
  type InputRequiredResult,
  inputRequired,
  inputResponse,
  McpServer,
} from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { type ApiClient, ApiError, type QuoteSummary } from './api.js';

const dollars = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const ok = (text: string, structured: Record<string, unknown>): CallToolResult => ({
  content: [{ type: 'text', text }],
  structuredContent: structured,
});

// An API refusal is something the model can read and act on, not a crash.
export function failure(error: unknown): CallToolResult {
  const text =
    error instanceof ApiError
      ? `${error.code}: ${error.message}`
      : 'the request could not be completed';
  return { content: [{ type: 'text', text }], isError: true };
}

// A retry of the same call must not create a second quote, so the key is a hash of what was asked.
export function keyFor(prefix: string, args: unknown): string {
  return `${prefix}-${createHash('sha256').update(JSON.stringify(args)).digest('hex').slice(0, 32)}`;
}

function describeQuote(q: QuoteSummary): CallToolResult {
  const summary = {
    id: q.id,
    state: q.state,
    // Tags, for a key without personal:read: handed back to create_quote, they quote for the same person.
    holder: q.holder,
    totalDollars: q.premium ? q.premium.totalCents / 100 : null,
    referralReasons: q.referralReasons,
    expiresAt: q.expiresAt,
  };
  if (q.state === 'quoted' && q.premium) {
    return ok(
      `Quote ${q.id} for ${q.holder.name}: ${dollars(q.premium.totalCents)} including tax, valid until ${q.expiresAt.slice(0, 10)}. It can be bound.`,
      summary,
    );
  }
  if (q.state === 'referred') {
    const price = q.premium ? ` An indicative price is ${dollars(q.premium.totalCents)}.` : '';
    return ok(
      `Quote ${q.id} is with an underwriter (${q.referralReasons.join(', ')}). It cannot be bound until they decide.${price}`,
      summary,
    );
  }
  return ok(`Quote ${q.id} is ${q.state}.`, summary);
}

const PAY = 'Yes, pay and issue the policy';

type Confirmation =
  | { kind: 'accepted' }
  | { kind: 'declined' }
  | { kind: 'pending'; result: InputRequiredResult }
  | { kind: 'unavailable' };

// Asks the person, not the model, before something that cannot be taken back: money moving, a portal opening. Works on
// both generations of the protocol: a 2026 client answers an input_required result and calls again; a 2025 client
// answers an elicitation request pushed mid-call.
export async function confirmWithUser(
  ctx: {
    mcpReq: {
      inputResponses?: Parameters<typeof inputResponse>[0];
      elicitInput: (
        request: never,
      ) => Promise<{ action: string; content?: Record<string, unknown> }>;
    };
  },
  message: string,
  title: string,
): Promise<Confirmation> {
  const confirmSchema = z.object({ confirm: z.boolean().meta({ title }) });
  const answered = inputResponse(ctx.mcpReq.inputResponses, 'confirm');
  if (answered.kind === 'elicit') {
    const content = acceptedContent(ctx.mcpReq.inputResponses, 'confirm', confirmSchema);
    return content?.confirm === true ? { kind: 'accepted' } : { kind: 'declined' };
  }
  try {
    const result = await ctx.mcpReq.elicitInput({
      mode: 'form',
      message,
      requestedSchema: {
        type: 'object',
        properties: { confirm: { type: 'boolean', title } },
        required: ['confirm'],
      },
    } as never);
    return result.action === 'accept' && result.content?.confirm === true
      ? { kind: 'accepted' }
      : { kind: 'declined' };
  } catch (error) {
    const text = error instanceof Error ? error.message : '';
    if (/input_required|inputRequired|2026|retur/i.test(text)) {
      return {
        kind: 'pending',
        result: inputRequired({
          inputRequests: {
            confirm: inputRequired.elicit({ message, requestedSchema: confirmSchema }),
          },
        }),
      };
    }
    return { kind: 'unavailable' };
  }
}

export interface VenueServerOptions {
  /** The token sent with a payment. This project only simulates payments, so a fixed demo token is enough. */
  paymentToken: string;
  /** A client whose key may read personal details. It only words the confirmation the person sees before paying;
   *  nothing it reads goes into a tool result, so the model never gets it. Without one, the confirmation names nobody. */
  personal?: ApiClient;
}

// What the model is given for a person's e-mail when its key may not read personal details.
const EMAIL_TAG = /^\[EMAIL#[A-Z2-7]{6}\]$/;

export function createVenueServer(api: ApiClient, options: VenueServerOptions): McpServer {
  const server = new McpServer(
    { name: 'venue-cover', version: '1.0.0' },
    {
      instructions:
        'Quote and bind liability insurance for events. Describe the event with classify_event, search_activities to find the right activity, create_quote to price it, bind_quote to pay (the person is asked to confirm first). A quote can come back referred: an underwriter decides, and it cannot be bound until they do. Personal details may reach you as tags such as [NAME#7K3Q2A]: use them as they are, and hand them back to create_quote to quote for the same person; the person sees the real values when asked to confirm.',
    },
  );

  server.registerTool(
    'search_activities',
    {
      description:
        'Search the activity catalogue by name; returns the closest matches with their risk class.',
      inputSchema: z.object({
        q: z.string().min(1).max(120).describe('What to look for, e.g. "bouncy castle"'),
      }),
    },
    async ({ q }) => {
      try {
        const activities = await api.searchActivities(q);
        const text = activities
          .slice(0, 5)
          .map(
            (a) =>
              `${a.title} (${a.activityId}, class ${a.riskClass}, score ${a.score.toFixed(2)})`,
          )
          .join('\n');
        return ok(text || 'No activity matched.', { activities });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'classify_event',
    {
      description:
        'Read a free-text description of an event: finds the activities, the crowd, hours and alcohol, and says whether it could be priced automatically or needs an underwriter.',
      inputSchema: z.object({
        text: z.string().min(3).max(2000).describe("The description, in the customer's own words"),
      }),
    },
    async ({ text }) => {
      try {
        const c = await api.classify(text);
        const found = c.primary
          ? `${c.primary.title} (${c.primary.activityId}, class ${c.riskClass})`
          : 'no known activity';
        const verdict =
          c.decision.outcome === 'auto'
            ? 'can be priced automatically'
            : `needs a person: ${c.decision.reasons.join(', ')}`;
        return ok(`Found ${found}. This ${verdict}.`, {
          classificationId: c.id,
          riskClass: c.riskClass,
          primary: c.primary,
          facts: c.facts,
          decision: c.decision,
          degraded: c.degraded,
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'create_quote',
    {
      description:
        'Create a quote for an event. Returns the price, or says it is referred to an underwriter and why. Repeating the same call returns the same quote.',
      inputSchema: z.object({
        activityId: z.string().describe('From search_activities or classify_event'),
        classificationId: z
          .string()
          .optional()
          .describe('From classify_event, when the quote follows a description'),
        participants: z.number().int().min(1).describe('The largest crowd at one time'),
        hours: z.number().positive().describe('Hours of cover, over all days'),
        alcohol: z.enum(['none', 'served', 'sold']),
        eventDate: z.iso.date().describe('YYYY-MM-DD'),
        startTime: z
          .string()
          .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
          .describe('HH:MM'),
        limit: z
          .enum(['2000000', '5000000'])
          .default('2000000')
          .describe('Liability limit in dollars'),
        holderName: z
          .string()
          .min(1)
          .max(200)
          .describe('The person insured, or the [NAME#…] tag you were given for them'),
        holderEmail: z
          .union([z.email(), z.string().regex(EMAIL_TAG)])
          .describe('Their e-mail, or the [EMAIL#…] tag you were given for it'),
        bookingRef: z
          .string()
          .max(100)
          .optional()
          .describe('The booking reference from the venue, if there is one'),
        answers: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
          .optional()
          .describe('Answers to follow-up questions'),
      }),
    },
    async (args) => {
      try {
        const { limit, holderName, holderEmail, ...rest } = args;
        const body = {
          ...rest,
          limitCents: Number(limit) * 100,
          holder: { name: holderName, email: holderEmail },
        };
        return describeQuote(await api.createQuote(body, keyFor('mcp-quote', body)));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'get_quote',
    { description: 'Read a quote and its state.', inputSchema: z.object({ quoteId: z.string() }) },
    async ({ quoteId }) => {
      try {
        return describeQuote(await api.getQuote(quoteId));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'bind_quote',
    {
      description:
        'Pay for a quote and issue the policy. The person is asked to confirm the amount first; nothing is charged unless they accept.',
      inputSchema: z.object({ quoteId: z.string() }),
    },
    async ({ quoteId }, ctx): Promise<CallToolResult | InputRequiredResult> => {
      try {
        const quote = await api.getQuote(quoteId);
        if (quote.state !== 'quoted' || !quote.premium) return describeQuote(quote);

        // Worded for the person, with the real name when this server has a key allowed to read it.
        const shown = options.personal ? await options.personal.getQuote(quoteId) : null;
        const message = shown
          ? `Pay ${dollars(quote.premium.totalCents)} for the quote ${quote.id} (${shown.holder.name}) and issue the policy? A certificate is sent to ${shown.holder.email}.`
          : `Pay ${dollars(quote.premium.totalCents)} for the quote ${quote.id} and issue the policy? A certificate is sent to the e-mail on the quote.`;
        const decision = await confirmWithUser(ctx as never, message, PAY);
        if (decision.kind === 'pending') return decision.result;
        if (decision.kind === 'unavailable') {
          return {
            content: [
              {
                type: 'text',
                text: 'Not bound: this client cannot ask the person to confirm, and nothing is charged without that.',
              },
            ],
            isError: true,
          };
        }
        if (decision.kind === 'declined')
          return ok('Not bound: the person did not confirm. Nothing was charged.', {
            bound: false,
            quoteId,
          });

        const bound = await api.bindQuote(quoteId, options.paymentToken, `mcp-bind-${quoteId}`);
        return ok(`Policy ${bound.policyNumber} issued for ${dollars(quote.premium.totalCents)}.`, {
          bound: true,
          policyId: bound.policyId,
          policyNumber: bound.policyNumber,
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'get_policy',
    {
      description: 'Read a policy: number, period, amount and what it covers.',
      inputSchema: z.object({ policyId: z.string() }),
    },
    async ({ policyId }) => {
      try {
        const p = await api.getPolicy(policyId);
        return ok(
          `Policy ${p.policyNumber} for ${p.snapshot.holder.name}, ${p.snapshot.activityTitle}, ${p.startsAt.slice(0, 10)} to ${p.endsAt.slice(0, 10)}, ${dollars(p.totalCents)}.`,
          {
            policyId: p.id,
            policyNumber: p.policyNumber,
            totalDollars: p.totalCents / 100,
            startsAt: p.startsAt,
            endsAt: p.endsAt,
            certificatesRouted: p.snapshot.routed,
          },
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  return server;
}
