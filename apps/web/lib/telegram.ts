import { createHmac, timingSafeEqual } from 'node:crypto';

export interface TelegramUser {
  id: number;
  firstName: string;
  lastName?: string;
}

// What Telegram hands a Mini App (its "init data") is signed with the bot's token. The user in it is believed only when
// the signature holds and it is under a day old; what the page could read without checking is never used.
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
export function verifyInitData(
  initData: string,
  botToken: string,
  nowSeconds: number,
  maxAgeSeconds = 86_400,
): TelegramUser | null {
  const fields = new URLSearchParams(initData);
  const hash = fields.get('hash') ?? '';
  if (!/^[0-9a-f]{64}$/.test(hash)) return null;
  fields.delete('hash');
  const check = [...fields.keys()]
    .sort()
    .map((key) => `${key}=${fields.get(key)}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(check).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) return null;
  if (!(nowSeconds - Number(fields.get('auth_date')) <= maxAgeSeconds)) return null;
  const user: unknown = JSON.parse(fields.get('user') ?? 'null');
  if (
    typeof user !== 'object' ||
    user === null ||
    !('id' in user && typeof user.id === 'number') ||
    !('first_name' in user && typeof user.first_name === 'string')
  )
    return null;
  const last = 'last_name' in user && typeof user.last_name === 'string' ? user.last_name : null;
  return { id: user.id, firstName: user.first_name, ...(last ? { lastName: last } : {}) };
}
