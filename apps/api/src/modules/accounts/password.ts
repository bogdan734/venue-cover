import { randomBytes, type ScryptOptions, scrypt, timingSafeEqual } from 'node:crypto';

// scrypt, the memory-hard function in Node's own crypto, with the cost OWASP lists for it (N = 2^17 needs 128 MiB per
// guess; this uses 2^15 to stay quick on a laptop demo while far above a fast hash). The parameters travel with the hash,
// so they can be raised later and old hashes still verify.
const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;

function derive(
  password: string,
  salt: Buffer,
  options: ScryptOptions & { keylen: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      options.keylen,
      { ...options, maxmem: 256 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, { N, r: R, p: P, keylen: KEY_LENGTH });
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  if (expected.length === 0) return false;
  try {
    const key = await derive(password, Buffer.from(salt, 'base64url'), {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      keylen: expected.length,
    });
    return timingSafeEqual(key, expected);
  } catch {
    // Parameters scrypt refuses (an edited or foreign value) are a failed check, never a crash.
    return false;
  }
}

// What a sign-in for an unknown address is checked against, so that it takes as long as one for a real account.
let dummy: Promise<string> | undefined;
export const dummyHash = (): Promise<string> => {
  dummy ??= hashPassword(randomBytes(16).toString('hex'));
  return dummy;
};
