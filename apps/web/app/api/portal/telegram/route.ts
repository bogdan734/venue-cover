import { verifyInitData } from '@/lib/telegram';

// A portal opened inside Telegram sends what Telegram signed about the person; when the bot's token proves it, the answer
// is their name, for the page to fill in. Nothing is stored and no session starts from it.
export async function POST(request: Request) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return Response.json({ error: 'This demo has no Telegram bot.' }, { status: 404 });
  const body: unknown = await request.json();
  const initData =
    typeof body === 'object' && body !== null && 'initData' in body ? body.initData : null;
  const user =
    typeof initData === 'string'
      ? verifyInitData(initData, token, Math.floor(Date.now() / 1000))
      : null;
  if (!user) return Response.json({ error: 'Not signed by Telegram.' }, { status: 401 });
  return Response.json({ name: [user.firstName, user.lastName].filter(Boolean).join(' ') });
}
