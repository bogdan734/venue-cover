import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';
import { hashToken, newToken } from './tokens.js';

describe('passwords', () => {
  it('verify against their own hash and nothing else', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('correct horse batterz', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('are stored as scrypt with a salt of their own, never as themselves', async () => {
    const [a, b] = [await hashPassword('same password'), await hashPassword('same password')];
    expect(a).toMatch(/^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain('same password');
  });

  it('refuse a stored value that is not one of ours', async () => {
    expect(await verifyPassword('x', 'plaintext')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$1$1$1$$')).toBe(false);
  });
});

describe('tokens', () => {
  it('are long, random and stored only as a hash', () => {
    const [a, b] = [newToken(), newToken()];
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(40);
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a)).toBe(hashToken(a));
    expect(hashToken(a)).not.toBe(hashToken(b));
  });
});
