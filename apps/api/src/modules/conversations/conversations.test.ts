import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/app.js';

let t: TestApp;
let portal: string; // program 1's portal, as the web app holds it
let other: string; // program 2's portal
let staff: string; // the inbox
let counter = 0;

beforeAll(async () => {
  t = await createTestApp();
  portal = await t.keyFor('prg_1', ['quotes:read', 'quotes:write', 'personal:read']);
  other = await t.keyFor('prg_2', ['quotes:read', 'quotes:write', 'personal:read']);
  staff = await t.keyFor(null, ['conversations:manage', 'personal:read']);
});
afterAll(() => t.close());

interface Line {
  sender: 'renter' | 'bot' | 'staff';
  text: string;
}

const call = (
  method: 'GET' | 'POST',
  url: string,
  key: string,
  payload?: object,
  headers: Record<string, string> = {},
) =>
  t.app.inject({
    method,
    url,
    headers: {
      authorization: `Bearer ${key}`,
      ...(method === 'POST' ? { 'idempotency-key': `c-${++counter}` } : {}),
      ...headers,
    },
    ...(payload ? { payload } : {}),
  });

async function open(key = portal) {
  const res = await call('POST', '/v1/conversations', key, {});
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string; key: string; state: string; messages: Line[] };
}

async function say(chat: { id: string; key: string }, text: string, key = portal) {
  const res = await call(
    'POST',
    `/v1/conversations/${chat.id}/messages`,
    key,
    { text },
    {
      'conversation-key': chat.key,
    },
  );
  expect(res.statusCode).toBe(201);
  return res.json() as { state: string; messages: Line[] };
}

const botSays = (lines: Line[]) =>
  lines
    .filter((l) => l.sender === 'bot')
    .map((l) => l.text)
    .join('\n');

describe('the portal chat', () => {
  it('opens with what it can do, and answers what is covered from the program’s own rules', async () => {
    const chat = await open();
    expect(botSays(chat.messages)).toMatch(/person/);
    const { state, messages } = await say(chat, 'Is alcohol covered, and up to what limit?');
    expect(state).toBe('bot');
    expect(botSays(messages)).toMatch(/\$2M/);
    expect(botSays(messages)).toMatch(/alcohol/i);
  });

  it('shows a policy to its holder only', async () => {
    const { policyNumber } = await t.bindPolicy('prg_1');
    const chat = await open();
    const asked = botSays((await say(chat, `Where is my policy ${policyNumber}?`)).messages);
    expect(asked).toMatch(/e-mail/);
    expect(asked).not.toMatch(/in force|ended|starts/);

    const shown = botSays((await say(chat, `${policyNumber}, pat@example.org`)).messages);
    expect(shown).toContain(policyNumber);
    expect(shown).toMatch(/in force|starts|ended/);
  });

  it('hands a claim to a person with the policy attached', async () => {
    const { policyNumber } = await t.bindPolicy('prg_1');
    const chat = await open();
    const { state, messages } = await say(
      chat,
      `Someone was hurt at our party. Policy ${policyNumber}, pat@example.org`,
    );
    expect(state).toBe('waiting');
    expect(botSays(messages)).toMatch(/person/);

    const inbox = (await call('GET', '/v1/inbox', staff)).json().conversations;
    expect(inbox.find((c: { id: string }) => c.id === chat.id)).toMatchObject({
      state: 'waiting',
      program: { code: 'FHV' },
    });
    const detail = (await call('GET', `/v1/inbox/${chat.id}`, staff)).json();
    expect(detail.context).toMatchObject({ reason: 'claim', policy: { policyNumber } });
  });

  it('asks a claim for its policy number, and adds the policy once its holder shows it is theirs', async () => {
    const { policyNumber } = await t.bindPolicy('prg_1');
    const chat = await open();
    const { state, messages } = await say(chat, 'Someone was hurt at our party');
    expect(state).toBe('waiting');
    expect(botSays(messages)).toMatch(/policy number/);

    expect(botSays((await say(chat, policyNumber)).messages)).toMatch(/e-mail/);
    const bare = (await call('GET', `/v1/inbox/${chat.id}`, staff)).json();
    expect(bare.context.policy).toBeUndefined();

    expect(botSays((await say(chat, `${policyNumber}, pat@example.org`)).messages)).toMatch(
      /added/,
    );
    const attached = (await call('GET', `/v1/inbox/${chat.id}`, staff)).json();
    expect(attached.context).toMatchObject({ reason: 'claim', policy: { policyNumber } });
  });

  it('sends what the rules cannot read to the model, with personal details as tags', async () => {
    let seen = '';
    t.llm.handler = (request) => {
      seen = request.user;
      return { intent: 'price' };
    };
    const chat = await open();
    const { messages } = await say(chat, 'Could 613-555-0199 get something sorted for the 20th?');
    expect(seen).toMatch(/\[PHONE#[A-Z2-7]{6}\]/);
    expect(seen).not.toContain('555-0199');
    expect(botSays(messages)).toMatch(/describe/i);

    const stored = await t.db
      .selectFrom('message')
      .select('text')
      .where('conversation_id', '=', chat.id)
      .where('sender', '=', 'renter')
      .executeTakeFirstOrThrow();
    expect(stored.text).not.toContain('555-0199');
    const read = (
      await call('GET', `/v1/conversations/${chat.id}`, portal, undefined, {
        'conversation-key': chat.key,
      })
    ).json();
    expect(read.messages.find((l: Line) => l.sender === 'renter').text).toContain('613-555-0199');
  });

  it('is read only with its own key, on its own program', async () => {
    const chat = await open();
    const wrong = await call('GET', `/v1/conversations/${chat.id}`, portal, undefined, {
      'conversation-key': 'not-the-key',
    });
    expect(wrong.statusCode).toBe(404);
    const elsewhere = await call('GET', `/v1/conversations/${chat.id}`, other, undefined, {
      'conversation-key': chat.key,
    });
    expect(elsewhere.statusCode).toBe(404);
  });
});

describe('the staff inbox', () => {
  it('takes a conversation over with a reply; the bot is quiet until it is closed', async () => {
    const chat = await open();
    const reply = await call('POST', `/v1/inbox/${chat.id}/messages`, staff, {
      text: 'Hello, this is Sam from the hall office.',
    });
    expect(reply.statusCode).toBe(201);

    const quiet = await say(chat, 'Thanks Sam, what about the parking lot?');
    expect(quiet.state).toBe('human');
    expect(botSays(quiet.messages)).toBe('');

    expect(
      (await call('POST', `/v1/inbox/${chat.id}/state`, staff, { to: 'closed' })).statusCode,
    ).toBe(200);
    const back = await say(chat, 'Is alcohol covered?');
    expect(back.state).toBe('bot');
    expect(botSays(back.messages)).toMatch(/alcohol/i);
  });

  it('is for keys allowed to manage conversations', async () => {
    expect((await call('GET', '/v1/inbox', portal)).statusCode).toBe(403);
  });
});
