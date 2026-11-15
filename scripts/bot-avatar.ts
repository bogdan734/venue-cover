import { readFileSync } from 'node:fs';
import { createTelegram } from '../apps/api/src/modules/conversations/index.js';

// Sets the Telegram bot's picture from docs/media/bot-avatar.jpg (made by scripts/media/hero.ts):
//   npm run bot:avatar
// The bot's token is TELEGRAM_BOT_TOKEN in .env.public, as for `npm run public`; it is never printed. Telegram keeps the
// picture until another is set, so this runs once per bot. Its description and commands are set by the platform itself
// every time it starts with the token.
process.loadEnvFile(new URL('../.env.public', import.meta.url));
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set in .env.public');

const bot = await createTelegram({ token, fetch: globalThis.fetch });
await bot.setPhoto(readFileSync(new URL('../docs/media/bot-avatar.jpg', import.meta.url)));
console.log(`the picture of @${bot.username} is set`);
