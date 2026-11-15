import type { AddressInfo } from 'node:net';
import {
  Client,
  InMemoryTransport,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../api/test/app.js';
import { ApiClient } from '../src/api.js';
import { buildMcpApp } from '../src/app.js';
import { createVenueServer } from '../src/server.js';

let t: TestApp;
let apiUrl: string;
let key: string;
let personalKey: string; // may read personal details: words the confirmation, never a tool result

beforeAll(async () => {
  t = await createTestApp();
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  apiUrl = `http://127.0.0.1:${(t.app.server.address() as AddressInfo).port}`;
  key = await t.keyFor('prg_1', ['quotes:read', 'quotes:write']);
  personalKey = await t.keyFor('prg_1', ['quotes:read', 'personal:read']);
});
afterAll(() => t.close());

type Answer =
  | { action: 'accept'; content?: Record<string, unknown> }
  | { action: 'decline' }
  | { action: 'cancel' };

interface Asked {
  count: number;
  messages: string[];
}

// A client that answers every confirmation with `answer`, and keeps what it was asked.
function newClient(answer: Answer, asked: Asked) {
  const client = new Client(
    { name: 'test-host', version: '1.0.0' },
    { versionNegotiation: { mode: 'auto' }, capabilities: { elicitation: { form: {} } } },
  );
  client.setRequestHandler('elicitation/create', async (request) => {
    asked.count++;
    asked.messages.push(String((request as { params?: { message?: string } }).params?.message));
    return answer as never;
  });
  return client;
}

// The 2026-era path: the handler is served in-process and the client goes through its fetch.
async function connectModern(
  answer: Answer = { action: 'accept', content: { confirm: true } },
  personal = false,
) {
  const handler = createMcpHandler(() =>
    createVenueServer(new ApiClient({ baseUrl: apiUrl, apiKey: key }), {
      paymentToken: 'tok_ok',
      ...(personal ? { personal: new ApiClient({ baseUrl: apiUrl, apiKey: personalKey }) } : {}),
    }),
  );
  const asked: Asked = { count: 0, messages: [] };
  const client = newClient(answer, asked);
  await client.connect(
    new StreamableHTTPClientTransport(new URL('http://mcp.test/mcp'), {
      fetch: (url, init) => handler.fetch(new Request(url, init)),
    }),
  );
  return {
    client,
    asked,
    close: async () => {
      await client.close();
      await handler.close();
    },
  };
}

// The 2025-era path: a linked in-memory pair.
async function connectLegacy(answer: Answer) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createVenueServer(new ApiClient({ baseUrl: apiUrl, apiKey: key }), {
    paymentToken: 'tok_ok',
  });
  const asked: Asked = { count: 0, messages: [] };
  const client = new Client(
    { name: 'legacy-host', version: '1.0.0' },
    { capabilities: { elicitation: { form: {} } } },
  );
  client.setRequestHandler('elicitation/create', async () => {
    asked.count++;
    return answer as never;
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, asked, close: () => client.close() };
}

const quoteArgs = (over: Record<string, unknown> = {}) => ({
  activityId: '',
  participants: 20,
  hours: 2,
  alcohol: 'none',
  eventDate: '2026-12-20',
  startTime: '18:00',
  holderName: 'Pat Example',
  holderEmail: 'pat@example.org',
  ...over,
});
const text = (result: { content: { type: string; text?: string }[] }) =>
  result.content.map((c) => c.text ?? '').join('\n');

describe('the tools', () => {
  it('lists its tools with their input schemas', async () => {
    const { client, close } = await connectModern();
    try {
      const { tools } = await client.listTools();
      expect(tools.map((x) => x.name).sort()).toEqual([
        'bind_quote',
        'classify_event',
        'create_quote',
        'get_policy',
        'get_quote',
        'search_activities',
      ]);
      const schema = (tools.find((x) => x.name === 'create_quote')?.inputSchema ?? {}) as {
        properties?: object;
        required?: string[];
      };
      expect(Object.keys(schema.properties ?? {})).toEqual(
        expect.arrayContaining([
          'activityId',
          'participants',
          'hours',
          'alcohol',
          'eventDate',
          'holderEmail',
        ]),
      );
      expect(schema.required).toEqual(expect.arrayContaining(['activityId', 'holderName']));
    } finally {
      await close();
    }
  });

  it('searches the catalogue and classifies a description', async () => {
    const { client, close } = await connectModern();
    try {
      const found = await client.callTool({ name: 'search_activities', arguments: { q: 'yoga' } });
      expect(found.isError).toBeFalsy();
      expect(text(found as never)).toContain('Yoga class');
      t.llm.handler = () => ({
        activities: ['yoga class'],
        participants: 20,
        hours: 2,
        alcohol: 'none',
        flags: [],
      });
      const classified = await client.callTool({
        name: 'classify_event',
        arguments: { text: 'Yoga class for 20 people, 2 hours, no alcohol' },
      });
      expect(text(classified as never)).toContain('can be priced automatically');
      expect(
        (classified.structuredContent as { decision: { outcome: string } }).decision.outcome,
      ).toBe('auto');
    } finally {
      await close();
    }
  });

  it('prices a quote, and the same call twice gives the same quote', async () => {
    const { client, close } = await connectModern();
    try {
      const args = quoteArgs({ activityId: await t.activityId('Yoga class') });
      const first = await client.callTool({ name: 'create_quote', arguments: args });
      const second = await client.callTool({ name: 'create_quote', arguments: args });
      expect(first.isError).toBeFalsy();
      const a = first.structuredContent as { id: string; state: string; totalDollars: number };
      expect(a.state).toBe('quoted');
      expect(a.totalDollars).toBeGreaterThan(0);
      expect((second.structuredContent as { id: string }).id).toBe(a.id);
      expect(text(first as never)).toContain('can be bound');
    } finally {
      await close();
    }
  });

  it('reports a referred quote as its status, not as an error', async () => {
    const { client, close } = await connectModern();
    try {
      const result = await client.callTool({
        name: 'create_quote',
        arguments: quoteArgs({ activityId: await t.activityId('Ice hockey game') }),
      });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({
        state: 'referred',
        referralReasons: ['PROGRAM_RULE'],
      });
      expect(text(result as never)).toMatch(/with an underwriter/);
    } finally {
      await close();
    }
  });

  it('returns an API refusal as a tool error the model can read', async () => {
    const { client, close } = await connectModern();
    try {
      const unknown = await client.callTool({
        name: 'create_quote',
        arguments: quoteArgs({ activityId: 'act_nope' }),
      });
      expect(unknown.isError).toBe(true);
      expect(text(unknown as never)).toContain('activity_not_found');
      const past = await client.callTool({
        name: 'create_quote',
        arguments: quoteArgs({
          activityId: await t.activityId('Yoga class'),
          eventDate: '2026-01-01',
        }),
      });
      expect(text(past as never)).toContain('event_in_the_past');
      const bad = await client.callTool({
        name: 'create_quote',
        arguments: { activityId: 'x', participants: 0 },
      });
      expect(bad.isError).toBe(true); // refused by the tool's own input schema, before any request
    } finally {
      await close();
    }
  });
});

describe('binding', () => {
  let made = 0; // a distinct holder each time: the same arguments would return the same quote
  const makeQuote = async (client: Client, over: Record<string, unknown> = {}) => {
    const result = await client.callTool({
      name: 'create_quote',
      arguments: quoteArgs({
        activityId: await t.activityId('Yoga class'),
        holderName: `Pat ${++made}`,
        ...over,
      }),
    });
    return (result.structuredContent as { id: string }).id;
  };

  it('binds after the person accepts (2026 clients)', async () => {
    const { client, asked, close } = await connectModern();
    try {
      const id = await makeQuote(client);
      const before = t.payments.calls.length;
      const result = await client.callTool({ name: 'bind_quote', arguments: { quoteId: id } });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({ bound: true });
      expect(text(result as never)).toMatch(/Policy FHV-\d{6} issued/);
      expect(asked.count).toBe(1);
      expect(t.payments.calls.length).toBe(before + 1);
      expect(t.payments.calls.at(-1)).toMatchObject({ reference: id, token: 'tok_ok' });
    } finally {
      await close();
    }
  });

  it('binds after the person accepts (2025 clients)', async () => {
    const { client, asked, close } = await connectLegacy({
      action: 'accept',
      content: { confirm: true },
    });
    try {
      const id = await makeQuote(client);
      const result = await client.callTool({ name: 'bind_quote', arguments: { quoteId: id } });
      expect(result.structuredContent).toMatchObject({ bound: true });
      expect(asked.count).toBe(1);
    } finally {
      await close();
    }
  });

  it('stops when the person declines, cancels or leaves the box unticked, and charges nothing', async () => {
    for (const answer of [
      { action: 'decline' },
      { action: 'cancel' },
      { action: 'accept', content: { confirm: false } },
    ] as Answer[]) {
      for (const connect of [connectModern, connectLegacy]) {
        const { client, asked, close } = await connect(answer);
        try {
          const id = await makeQuote(client);
          const before = t.payments.calls.length;
          const result = await client.callTool({ name: 'bind_quote', arguments: { quoteId: id } });
          expect(result.structuredContent).toMatchObject({ bound: false });
          expect(text(result as never)).toMatch(/did not confirm/);
          expect(asked.count).toBe(1);
          expect(t.payments.calls.length).toBe(before);
          expect(
            (await client.callTool({ name: 'get_quote', arguments: { quoteId: id } }))
              .structuredContent,
          ).toMatchObject({ state: 'quoted' });
        } finally {
          await close();
        }
      }
    }
  });

  it('does not ask, and says why, for a quote that cannot be bound', async () => {
    const { client, asked, close } = await connectModern();
    try {
      const id = await makeQuote(client, { activityId: await t.activityId('Ice hockey game') });
      const result = await client.callTool({ name: 'bind_quote', arguments: { quoteId: id } });
      expect(text(result as never)).toMatch(/with an underwriter/);
      expect(asked.count).toBe(0);
    } finally {
      await close();
    }
  });

  it('reads the policy it issued', async () => {
    const { client, close } = await connectModern();
    try {
      const id = await makeQuote(client);
      const bound = await client.callTool({ name: 'bind_quote', arguments: { quoteId: id } });
      const { policyId } = bound.structuredContent as { policyId: string };
      const policy = await client.callTool({ name: 'get_policy', arguments: { policyId } });
      expect(text(policy as never)).toMatch(/Yoga class/);
      expect(policy.structuredContent).toMatchObject({ policyId });
    } finally {
      await close();
    }
  });
});

describe('the HTTP endpoint', () => {
  it('forwards the caller key to the API, and refuses a caller without one', async () => {
    const app = buildMcpApp({ apiUrl, paymentToken: 'tok_ok' });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const url = new URL(`http://127.0.0.1:${(app.server.address() as AddressInfo).port}/mcp`);
    const connect = async (headers: Record<string, string>) => {
      const client = new Client(
        { name: 'http-host', version: '1.0.0' },
        { versionNegotiation: { mode: 'auto' } },
      );
      await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers } }));
      return client;
    };
    try {
      const withKey = await connect({ authorization: `Bearer ${key}` });
      expect(
        text(
          (await withKey.callTool({
            name: 'search_activities',
            arguments: { q: 'yoga' },
          })) as never,
        ),
      ).toContain('Yoga class');
      await withKey.close();

      const anonymous = await connect({});
      const refused = await anonymous.callTool({
        name: 'search_activities',
        arguments: { q: 'yoga' },
      });
      expect(refused.isError).toBe(true);
      expect(text(refused as never)).toContain('unauthorized');
      await anonymous.close();
    } finally {
      await app.close();
    }
  });
});

describe('personal details', () => {
  const bindFor = async (client: Client, holderName: string, holderEmail: string) => {
    const created = await client.callTool({
      name: 'create_quote',
      arguments: quoteArgs({
        activityId: await t.activityId('Yoga class'),
        holderName,
        holderEmail,
      }),
    });
    const quote = created.structuredContent as {
      id: string;
      holder: { name: string; email: string };
    };
    const bound = await client.callTool({ name: 'bind_quote', arguments: { quoteId: quote.id } });
    return { created, quote, bound };
  };

  it('reach the model as tags, never as the name or the e-mail', async () => {
    const { client, asked, close } = await connectModern();
    try {
      const { created, bound } = await bindFor(client, 'Sam Rivera', 'sam.rivera@example.org');
      const { policyId } = bound.structuredContent as { policyId: string };
      const policy = await client.callTool({ name: 'get_policy', arguments: { policyId } });
      for (const result of [created, bound, policy]) {
        expect(JSON.stringify(result)).not.toMatch(/Sam Rivera|sam\.rivera@/);
      }
      expect(text(created as never)).toMatch(/for \[NAME#[A-Z2-7]{6}\]/);
      // Without a key that may read them, the confirmation names nobody either.
      expect(asked.messages.at(-1)).toContain('the e-mail on the quote');
    } finally {
      await close();
    }
  });

  it('can be handed back as tags, and the person sees the real ones when asked to confirm', async () => {
    const { client, asked, close } = await connectModern(undefined, true);
    try {
      const first = await bindFor(client, 'Ana Silva', 'ana.silva@example.org');
      const { holder } = first.quote;
      expect(holder.name).toMatch(/^\[NAME#[A-Z2-7]{6}\]$/);
      const again = await bindFor(client, holder.name, holder.email);
      expect(again.created.isError).toBeFalsy();
      expect(again.bound.structuredContent).toMatchObject({ bound: true });
      expect(asked.messages.at(-1)).toContain('(Ana Silva)');
      expect(asked.messages.at(-1)).toContain('ana.silva@example.org');
      expect(JSON.stringify([again.created, again.bound])).not.toMatch(/Ana Silva|ana\.silva@/);
    } finally {
      await close();
    }
  });
});
