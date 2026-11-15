import type { FetchLike } from '../intake/index.js';

export interface TelegramMessage {
  chatId: string;
  text: string;
}

/** A button that opens a page inside Telegram, as a Mini App. Telegram opens https addresses only. */
export interface AppButton {
  label: string;
  url: string;
}

/** What can be put under a message: a button that opens a page, or answers to tap in place of typing. */
export interface Extras {
  app?: AppButton;
  choices?: readonly string[];
}

/** What goes back to the chat: a message, or a message with something to tap. */
export type Reply = string | ({ text: string } & Extras);

/** What the bot says about itself in Telegram: in an empty chat, on its profile page, and in its list of commands. */
export interface BotProfile {
  description: string;
  shortDescription: string;
  commands: { command: string; description: string }[];
}

export type TelegramHandler = (message: TelegramMessage) => Promise<Reply[]>;

export interface TelegramBot {
  readonly username: string;
  /** Opens the bot with the portal already chosen. */
  startLink(code: string): string;
  send(chatId: string, text: string, extras?: Extras): Promise<void>;
  /** The button beside the message field of every chat with the bot. */
  setMenu(app: AppButton): Promise<void>;
  setProfile(profile: BotProfile): Promise<void>;
  /** The bot's picture, a JPEG file. Telegram keeps it until another is set. */
  setPhoto(jpeg: Uint8Array): Promise<void>;
  /** Asks for the next updates once, answers each private message, and says how many updates there were. */
  pollOnce(handle: TelegramHandler, timeoutSeconds?: number, signal?: AbortSignal): Promise<number>;
  /** Long-polls until stopped. Nothing needs to reach this machine from outside: it asks Telegram, Telegram answers. */
  start(handle: TelegramHandler, onError: (error: unknown) => void): { stop(): Promise<void> };
}

interface Update {
  update_id: number;
  message?: { chat?: { id?: number | string; type?: string }; text?: unknown };
}

// An inline button that opens a page, or a keyboard of answers that goes away once one is tapped.
function replyMarkup({ app, choices }: Extras = {}): object | undefined {
  if (app) return { inline_keyboard: [[{ text: app.label, web_app: { url: app.url } }]] };
  if (choices) {
    return {
      keyboard: choices.map((text) => [{ text }]),
      resize_keyboard: true,
      one_time_keyboard: true,
    };
  }
  return undefined;
}

// The Bot API over HTTPS. Errors name the method and Telegram's reason, never the URL, which holds the token.
export async function createTelegram(options: {
  token: string;
  fetch: FetchLike;
}): Promise<TelegramBot> {
  async function call<T>(
    method: string,
    body: object | FormData = {},
    signal?: AbortSignal,
  ): Promise<T> {
    const upload = body instanceof FormData;
    const response = await options.fetch(`https://api.telegram.org/bot${options.token}/${method}`, {
      method: 'POST',
      ...(upload ? {} : { headers: { 'content-type': 'application/json' } }),
      body: upload ? body : JSON.stringify(body),
      signal,
    });
    const answer = (await response.json()) as { ok: boolean; result: T; description?: string };
    if (!answer.ok)
      throw new Error(`Telegram ${method} failed: ${answer.description ?? response.status}`);
    return answer.result;
  }

  const { username } = await call<{ username: string }>('getMe');
  let offset = 0;

  const bot: TelegramBot = {
    username,
    startLink: (code) => `https://t.me/${username}?start=${encodeURIComponent(code)}`,
    async send(chatId, text, extras) {
      const markup = replyMarkup(extras);
      await call('sendMessage', {
        chat_id: chatId,
        text,
        ...(markup ? { reply_markup: markup } : {}),
      });
    },
    async setProfile(profile) {
      await call('setMyCommands', { commands: profile.commands });
      await call('setMyDescription', { description: profile.description });
      await call('setMyShortDescription', { short_description: profile.shortDescription });
    },
    async setPhoto(jpeg) {
      const form = new FormData();
      form.set('photo', JSON.stringify({ type: 'static', photo: 'attach://image' }));
      form.set('image', new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }), 'avatar.jpg');
      await call('setMyProfilePhoto', form);
    },
    async setMenu(app) {
      await call('setChatMenuButton', {
        menu_button: { type: 'web_app', text: app.label, web_app: { url: app.url } },
      });
    },
    async pollOnce(handle, timeoutSeconds = 0, signal) {
      const updates = await call<Update[]>(
        'getUpdates',
        { offset, timeout: timeoutSeconds, allowed_updates: ['message'] },
        signal,
      );
      for (const update of updates) {
        offset = update.update_id + 1;
        const { chat, text } = update.message ?? {};
        // Groups and channels are not conversations with a renter.
        if (chat?.type !== 'private' || chat.id === undefined || typeof text !== 'string') continue;
        const chatId = String(chat.id);
        try {
          for (const reply of await handle({ chatId, text })) {
            if (typeof reply === 'string') await bot.send(chatId, reply);
            else await bot.send(chatId, reply.text, reply);
          }
        } catch (error) {
          console.error('a Telegram message could not be answered:', error);
        }
      }
      return updates.length;
    },
    start(handle, onError) {
      const abort = new AbortController();
      const loop = (async () => {
        while (!abort.signal.aborted) {
          try {
            await bot.pollOnce(handle, 25, abort.signal);
          } catch (error) {
            if (abort.signal.aborted) break;
            onError(error);
            await new Promise((resolve) => setTimeout(resolve, 5000));
          }
        }
      })();
      return {
        async stop() {
          abort.abort();
          await loop;
        },
      };
    },
  };
  return bot;
}
