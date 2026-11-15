import type { AddressInfo } from 'node:net';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiKey } from '../../api/src/modules/auth/index.js';
import { createTestApp, type TestApp } from '../../api/test/app.js';
import { ApiClient } from '../src/api.js';
import { createOnboardingServer } from '../src/onboarding.js';

let t: TestApp;
let apiUrl: string;
let agentKey: string; // manages programs, and nothing else
let operator: string;

beforeAll(async () => {
  t = await createTestApp();
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  apiUrl = `http://127.0.0.1:${(t.app.server.address() as AddressInfo).port}`;
  agentKey = (
    await createApiKey(t.db, { name: 'agent', programId: null, scopes: ['programs:manage'] })
  ).key;
  operator = await t.keyFor(null, ['programs:manage']);
});
afterAll(() => t.close());

type Answer = { action: 'accept'; content: Record<string, unknown> } | { action: 'decline' };

async function connect(answer: Answer) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createOnboardingServer(new ApiClient({ baseUrl: apiUrl, apiKey: agentKey }));
  const asked: string[] = [];
  const client = new Client(
    { name: 'test-host', version: '1.0.0' },
    { capabilities: { elicitation: { form: {} } } },
  );
  client.setRequestHandler('elicitation/create', async (request) => {
    asked.push(String((request as { params?: { message?: string } }).params?.message));
    return answer as never;
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, asked, close: () => client.close() };
}

const call = async (client: Client, name: string, args: Record<string, unknown>) =>
  (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: { text?: string }[];
    structuredContent?: Record<string, unknown>;
  };

const status = async (id: string) =>
  (
    await t.app.inject({
      method: 'GET',
      url: `/v1/programs/${id}`,
      headers: { authorization: `Bearer ${operator}` },
    })
  ).json().status;

describe('the onboarding agent', () => {
  it('drafts a client from a letter, gives it a look, and waits for the person to open it', async () => {
    const declining = await connect({ action: 'decline' });
    const drafted = await call(declining.client, 'draft_client', {
      name: 'Harbour Arts Centre',
      code: 'HAC',
      province: 'NS',
      letter: 'We rent our hall for up to 120 people. Offer limits of $2M and $5M.',
    });
    expect(drafted.isError).toBeFalsy();
    const id = drafted.structuredContent?.programId as string;
    expect(drafted.structuredContent).toMatchObject({ status: 'draft', code: 'HAC' });
    expect(drafted.structuredContent?.changed).toContain('maxParticipantsAuto');

    const unreadable = await call(declining.client, 'set_appearance', {
      programId: id,
      brand: '#f5c518',
    });
    expect(unreadable.isError).toBe(true);
    expect(unreadable.content[0]?.text).toMatch(/contrast/);
    const styled = await call(declining.client, 'set_appearance', {
      programId: id,
      brand: '#0f5c4a',
      tagline: 'Halls by the harbour',
      supportEmail: 'help@harbourarts.example',
    });
    expect(styled.structuredContent).toMatchObject({ appearance: true, contacts: true });

    const previewed = await call(declining.client, 'preview_client', { programId: id });
    expect(previewed.structuredContent).toMatchObject({ status: 'test' });

    const refused = await call(declining.client, 'publish_client', { programId: id });
    expect(declining.asked[0]).toMatch(/Open Harbour Arts Centre/);
    expect(refused.structuredContent).toMatchObject({ opened: false });
    expect(await status(id)).toBe('test');
    await declining.close();

    const agreeing = await connect({ action: 'accept', content: { confirm: true } });
    const opened = await call(agreeing.client, 'publish_client', { programId: id });
    expect(opened.structuredContent).toMatchObject({ opened: true, status: 'live' });
    expect(await status(id)).toBe('live');
    await agreeing.close();

    const log = (
      await t.app.inject({
        method: 'GET',
        url: `/v1/programs/${id}/audit`,
        headers: { authorization: `Bearer ${operator}` },
      })
    ).json().entries as { action: string; actor: string }[];
    expect(new Set(log.map((e) => e.actor))).toEqual(new Set(['agent']));
    expect(log.map((e) => e.action)).toEqual(
      expect.arrayContaining([
        'program.created',
        'rules.published',
        'appearance.changed',
        'status.changed',
      ]),
    );
  });

  it('cannot read a report or take a payment', async () => {
    const agent = new ApiClient({ baseUrl: apiUrl, apiKey: agentKey });
    await expect(agent.getQuote('qte_any')).rejects.toMatchObject({ status: 403 });
    const report = await fetch(`${apiUrl}/v1/reports/policies?month=2026-11`, {
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(report.status).toBe(403);
  });
});
