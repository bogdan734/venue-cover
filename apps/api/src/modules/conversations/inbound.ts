import { greeting } from './bot.js';
import { intentOf, POLICY_NUMBER } from './intents.js';
import { helpText, WELCOME, WHICH_VENUE } from './profile.js';
import {
  type ConversationDeps,
  type ConversationRow,
  linesOf,
  receive,
  startConversation,
} from './service.js';
import type { Reply, TelegramMessage } from './telegram.js';

type Deps = ConversationDeps & { webAppUrl?: string };
type Venue = { id: string; code: string; name: string };

// The portals a Telegram chat can be about: open ones only, never a draft.
async function openPrograms(deps: Pick<ConversationDeps, 'db'>): Promise<Venue[]> {
  return deps.db
    .selectFrom('program')
    .select(['id', 'code', 'name'])
    .where('status', 'in', ['live', 'paused'])
    .orderBy('code')
    .execute();
}

// The venues as buttons: a tap sends the venue's name, which `named` reads back.
const venues = (programs: Venue[], text: string): Reply => ({
  text,
  choices: programs.map((p) => p.name),
});

// The venue a message names, by its name (what a button sends) or its code, in any case.
const named = (programs: Venue[], text: string) =>
  programs.find(
    (p) => p.code === text.toUpperCase() || p.name.toLowerCase() === text.toLowerCase(),
  );

// The greeting's last line carries a button that opens the portal inside Telegram, when the portals have an https address.
function withPortal(lines: string[], code: string, webAppUrl: string | undefined): Reply[] {
  const last = lines.at(-1);
  if (!webAppUrl || last === undefined) return lines;
  return [
    ...lines.slice(0, -1),
    { text: last, app: { label: 'Open the portal', url: `${webAppUrl}/p/${code}` } },
  ];
}

const botLines = (lines: { sender: string; text: string }[]) =>
  lines.filter((line) => line.sender === 'bot').map((line) => line.text);

// Puts the chat on a venue: a new conversation with its greeting, or the chat's earlier one with that venue again.
async function open(
  deps: Deps,
  program: Venue,
  chatId: string,
): Promise<{ conversation: ConversationRow; replies: Reply[] }> {
  const existing = await deps.db
    .selectFrom('conversation')
    .selectAll()
    .where('program_id', '=', program.id)
    .where('channel', '=', 'telegram')
    .where('external_id', '=', chatId)
    .executeTakeFirst();
  if (!existing) {
    const { conversation } = await startConversation(deps, program.id, 'telegram', chatId);
    const lines = (await linesOf(deps, conversation, false)).map((line) => line.text);
    return { conversation, replies: withPortal(lines, program.code, deps.webAppUrl) };
  }
  const conversation = await deps.db
    .updateTable('conversation')
    .set({
      state: existing.state === 'closed' ? 'bot' : existing.state,
      updated_at: deps.clock(),
    })
    .where('id', '=', existing.id)
    .returningAll()
    .executeTakeFirstOrThrow();
  return { conversation, replies: withPortal([greeting(program)], program.code, deps.webAppUrl) };
}

const COMMAND = /^\/([a-z_]+)(?:@\w+)?(?:\s+(\S+))?\s*$/i;

// One message from a private Telegram chat. A chat needs no number to ask: it picks a venue by tapping its name, by
// `/start CODE` (what a portal's Telegram link sends) or by a policy number, whose first letters are the venue's code.
// Once there is a venue, the chat continues its latest conversation. The answers come back to be sent.
export async function handleTelegram(deps: Deps, message: TelegramMessage): Promise<Reply[]> {
  const text = message.text.trim();
  const programs = await openPrograms(deps);
  const command = COMMAND.exec(text)?.[1]?.toLowerCase();
  const current = await deps.db
    .selectFrom('conversation')
    .selectAll()
    .where('channel', '=', 'telegram')
    .where('external_id', '=', message.chatId)
    .orderBy('updated_at', 'desc')
    .limit(1)
    .executeTakeFirst();
  const venue = programs.find((p) => p.id === current?.program_id);

  if (command === 'start') {
    const program = named(programs, COMMAND.exec(text)?.[2] ?? '');
    return program
      ? (await open(deps, program, message.chatId)).replies
      : [venues(programs, WELCOME)];
  }
  // /help, and any command that is not known, explain what the bot does.
  if (command && command !== 'person') {
    return [venue ? helpText(venue.name) : venues(programs, helpText())];
  }
  // A person is asked for in words, whether typed or sent by /person.
  const said = command === 'person' ? 'Talk to a person' : text;

  const chosen = command ? undefined : named(programs, text);
  if (chosen) return (await open(deps, chosen, message.chatId)).replies;
  if (current && venue) {
    // The answers go back to the renter's own chat, so they are sent as written.
    return botLines((await receive(deps, current, said, null, true)).lines);
  }

  const number = POLICY_NUMBER.exec(said)?.[1]?.toUpperCase();
  const byNumber = number ? programs.find((p) => number.startsWith(`${p.code}-`)) : undefined;
  if (byNumber) {
    const { conversation, replies } = await open(deps, byNumber, message.chatId);
    return [...replies, ...botLines((await receive(deps, conversation, said, null, true)).lines)];
  }
  return [venues(programs, intentOf(said) === 'greeting' ? WELCOME : WHICH_VENUE)];
}
