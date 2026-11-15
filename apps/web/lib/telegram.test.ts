import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyInitData } from './telegram';

const TOKEN = '123456:test-token';
const NOW = 1_800_000_000;
const USER = JSON.stringify({ id: 42, first_name: 'Pat', last_name: 'Example', username: 'pat' });

// Signs the way Telegram does: the fields in key order, one per line, under a key made from the bot's token.
function signed(fields: Record<string, string>, token = TOKEN): string {
  const check = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(check).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

describe('what Telegram hands a Mini App', () => {
  it('is trusted when the bot’s token signed it', () => {
    const data = signed({ auth_date: String(NOW - 60), query_id: 'AAHdF6IQ', user: USER });
    expect(verifyInitData(data, TOKEN, NOW)).toEqual({
      id: 42,
      firstName: 'Pat',
      lastName: 'Example',
    });
  });

  it('is refused when changed, signed for another bot, a day old, or not signed', () => {
    const fresh = String(NOW - 60);
    expect(
      verifyInitData(signed({ auth_date: fresh, user: USER }).replace('Pat', 'Sam'), TOKEN, NOW),
    ).toBeNull();
    expect(
      verifyInitData(signed({ auth_date: fresh, user: USER }, '999:other'), TOKEN, NOW),
    ).toBeNull();
    expect(
      verifyInitData(signed({ auth_date: String(NOW - 86_401), user: USER }), TOKEN, NOW),
    ).toBeNull();
    expect(
      verifyInitData(new URLSearchParams({ auth_date: fresh, user: USER }).toString(), TOKEN, NOW),
    ).toBeNull();
  });
});
