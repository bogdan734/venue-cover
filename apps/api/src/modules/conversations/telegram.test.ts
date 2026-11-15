import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/app.js';
import { createShield } from '../privacy/index.js';
import {
  BOT_PROFILE,
  createTelegram,
  handleTelegram,
  replyAsStaff,
  type TelegramBot,
} from './index.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

// Telegram's Bot API as far as the platform uses it: who the bot is, the next updates, sending a message, and what it sets
// about itself. `calls` keeps what each of those was sent; an uploaded file is kept as its type and size.
function fakeTelegram(updates: object[]) {
  const sent: { chat_id: string; text: string; reply_markup?: unknown }[] = [];
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    const method = url.split('/').at(-1) as string;
    const form = init?.body instanceof FormData ? init.body : null;
    const body: Record<string, unknown> = form
      ? Object.fromEntries(
          [...form].map(([name, value]) => [
            name,
            typeof value === 'string' ? value : { type: value.type, size: value.size },
          ]),
        )
      : init?.body
        ? JSON.parse(String(init.body))
        : {};
    calls.push({ method, body });
    let result: unknown = null;
    if (method === 'getMe') result = { username: 'test_demo_bot' };
    if (method === 'getUpdates') {
      result = updates
        .splice(0)
        .filter((u) => (u as { update_id: number }).update_id >= Number(body.offset ?? 0));
    }
    if (method === 'sendMessage') {
      sent.push(body as (typeof sent)[number]);
      result = { message_id: sent.length };
    }
    if (method.startsWith('set')) result = true;
    return new Response(JSON.stringify({ ok: result !== null, result }));
  };
  return { fetch, sent, calls };
}

// What a chat would send, in order, one chat at a time; returns what the bot said back.
let nextUpdate = 100;
async function converse(chat: number, texts: string[], extra: { webAppUrl?: string } = {}) {
  const telegram = fakeTelegram(
    texts.map((text) => ({
      update_id: nextUpdate++,
      message: { chat: { id: chat, type: 'private' }, text },
    })),
  );
  const bot = await createTelegram({ token: '1:test', fetch: telegram.fetch });
  await bot.pollOnce((message) => handleTelegram({ ...deps(), ...extra }, message));
  return telegram.sent;
}
const buttonsOf = (message?: { reply_markup?: unknown }) =>
  (message?.reply_markup as { keyboard?: { text: string }[][] } | undefined)?.keyboard
    ?.flat()
    .map((button) => button.text);

const deps = () => ({
  db: t.db,
  llm: { completeJson: async () => ({ intent: 'other' }) },
  shield: createShield({ secret: 'a test secret that is long enough' }),
  clock: () => t.now.value,
});

describe('Telegram', () => {
  it('learns its name, and its start link carries the portal', async () => {
    const bot = await createTelegram({ token: '1:test', fetch: fakeTelegram([]).fetch });
    expect(bot.username).toBe('test_demo_bot');
    expect(bot.startLink('FHV')).toBe('https://t.me/test_demo_bot?start=FHV');
  });

  it('turns a message into a conversation with the portal it started from, and sends the staff reply back', async () => {
    const telegram = fakeTelegram([
      { update_id: 7, message: { chat: { id: 4242, type: 'private' }, text: '/start FHV' } },
      {
        update_id: 8,
        message: { chat: { id: 4242, type: 'private' }, text: 'Is alcohol covered?' },
      },
      { update_id: 9, message: { chat: { id: 99, type: 'group' }, text: 'hello group' } },
    ]);
    const bot: TelegramBot = await createTelegram({ token: '1:test', fetch: telegram.fetch });
    const done = await bot.pollOnce((message) => handleTelegram(deps(), message));
    expect(done).toBe(3);

    const toChat = telegram.sent.filter((m) => m.chat_id === '4242').map((m) => m.text);
    expect(toChat[0]).toMatch(/Fairhaven/);
    expect(toChat.at(-1)).toMatch(/alcohol/i);
    expect(telegram.sent.some((m) => m.chat_id === '99')).toBe(false); // groups are not answered

    const conversation = await t.db
      .selectFrom('conversation')
      .selectAll()
      .where('channel', '=', 'telegram')
      .where('external_id', '=', '4242')
      .executeTakeFirstOrThrow();
    expect(conversation.program_id).toBe('prg_1');

    await replyAsStaff(
      { ...deps(), telegram: bot },
      { keyId: 'staff', programId: null, scopes: ['conversations:manage'] },
      conversation.id,
      'Hello from the hall office.',
    );
    expect(telegram.sent.at(-1)).toEqual({ chat_id: '4242', text: 'Hello from the hall office.' });
  });

  it('opens the portals inside Telegram: from the menu button, and from the greeting of a portal', async () => {
    const telegram = fakeTelegram([
      { update_id: 20, message: { chat: { id: 6262, type: 'private' }, text: '/start FHV' } },
    ]);
    const bot = await createTelegram({ token: '1:test', fetch: telegram.fetch });
    await bot.setMenu({ label: 'Get covered', url: 'https://demo.example/portals' });
    expect(telegram.calls.filter((c) => c.method === 'setChatMenuButton')).toEqual([
      {
        method: 'setChatMenuButton',
        body: {
          menu_button: {
            type: 'web_app',
            text: 'Get covered',
            web_app: { url: 'https://demo.example/portals' },
          },
        },
      },
    ]);

    await bot.pollOnce((message) =>
      handleTelegram({ ...deps(), webAppUrl: 'https://demo.example' }, message),
    );
    const toChat = telegram.sent.filter((m) => m.chat_id === '6262');
    expect(toChat.at(-1)?.reply_markup).toEqual({
      inline_keyboard: [
        [{ text: 'Open the portal', web_app: { url: 'https://demo.example/p/FHV' } }],
      ],
    });
    // Only the last line of the greeting carries the button.
    expect(toChat.slice(0, -1).every((m) => m.reply_markup === undefined)).toBe(true);
  });
});

describe('Telegram without a portal chosen', () => {
  it('offers the venues as buttons to a chat that starts with a question', async () => {
    const programs = await t.db.selectFrom('program').select('name').orderBy('code').execute();
    const [said] = await converse(9001, ['What is covered?']);
    expect(said?.text).toMatch(/which venue/i);
    expect(said?.reply_markup).toMatchObject({ one_time_keyboard: true });
    expect(buttonsOf(said)).toEqual(programs.map((p) => p.name));
  });

  it('opens the venue whose button is tapped, then answers from its rules with no number asked for', async () => {
    const venue = await t.db
      .selectFrom('program')
      .select(['id', 'name'])
      .where('code', '=', 'RVT')
      .executeTakeFirstOrThrow();
    const said = await converse(9002, [venue.name, 'Is alcohol covered?']);
    expect(said[0]?.text).toContain(`${venue.name} assistant`);
    expect(said.at(-1)?.text).toMatch(/alcohol/i);
    const row = await t.db
      .selectFrom('conversation')
      .select('program_id')
      .where('external_id', '=', '9002')
      .executeTakeFirstOrThrow();
    expect(row.program_id).toBe(venue.id);
  });

  it('finds the venue from a policy number in a first message, and shows the policy only to its holder', async () => {
    const { policyNumber } = await t.bindPolicy('prg_1');
    const first = await converse(9003, [`Where is my policy ${policyNumber}?`]);
    expect(first[0]?.text).toMatch(/Fairhaven/);
    expect(first.at(-1)?.text).toMatch(/e-mail/);
    expect(first.at(-1)?.text).not.toMatch(/in force|ended|starts/);

    const shown = await converse(9003, [`${policyNumber}, pat@example.org`]);
    expect(shown.at(-1)?.text).toContain(policyNumber);
    expect(shown.at(-1)?.text).toMatch(/in force|starts|ended/);
  });

  it('explains itself on /help, and offers the venues on /start without a code', async () => {
    const [help] = await converse(9004, ['/help']);
    expect(help?.text).toMatch(/policy number/);
    expect(help?.text).toContain('/person');
    expect(buttonsOf(help)?.length).toBeGreaterThan(0); // no venue yet, so it offers them

    const [start] = await converse(9005, ['/start']);
    expect(buttonsOf(start)?.length).toBeGreaterThan(0);
  });

  it('hands the chat to a person on /person once a venue is chosen', async () => {
    await converse(9006, ['/start FHV', '/person']);
    const row = await t.db
      .selectFrom('conversation')
      .select(['state', 'context'])
      .where('external_id', '=', '9006')
      .executeTakeFirstOrThrow();
    expect(row.state).toBe('waiting');
    expect(row.context).toMatchObject({ reason: 'human' });
  });

  it('does not tell a Telegram chat to sign in', async () => {
    const said = await converse(9007, ['/start FHV', 'Where is my policy?']);
    expect(said.at(-1)?.text).toMatch(/policy number/);
    expect(said.at(-1)?.text).not.toMatch(/sign in/i);
  });
});

describe('the bot’s own profile', () => {
  it('stays within Telegram’s limits and every command it lists is answered', async () => {
    expect(BOT_PROFILE.description.length).toBeLessThanOrEqual(512);
    expect(BOT_PROFILE.shortDescription.length).toBeLessThanOrEqual(120);
    for (const { command, description } of BOT_PROFILE.commands) {
      expect(command).toMatch(/^[a-z0-9_]{1,32}$/);
      expect(description.length).toBeGreaterThanOrEqual(3);
      expect((await converse(9100 + command.length, [`/${command}`])).length).toBeGreaterThan(0);
    }
  });

  it('is sent as commands and descriptions', async () => {
    const telegram = fakeTelegram([]);
    const bot = await createTelegram({ token: '1:test', fetch: telegram.fetch });
    await bot.setProfile(BOT_PROFILE);
    expect(telegram.calls.filter((c) => c.method.startsWith('setMy'))).toEqual([
      { method: 'setMyCommands', body: { commands: BOT_PROFILE.commands } },
      { method: 'setMyDescription', body: { description: BOT_PROFILE.description } },
      {
        method: 'setMyShortDescription',
        body: { short_description: BOT_PROFILE.shortDescription },
      },
    ]);
  });

  it('gets its picture as a new file', async () => {
    const telegram = fakeTelegram([]);
    const bot = await createTelegram({ token: '1:test', fetch: telegram.fetch });
    await bot.setPhoto(new Uint8Array([0xff, 0xd8, 0xff]));
    expect(telegram.calls.find((c) => c.method === 'setMyProfilePhoto')?.body).toEqual({
      photo: '{"type":"static","photo":"attach://image"}',
      image: { type: 'image/jpeg', size: 3 },
    });
  });
});
