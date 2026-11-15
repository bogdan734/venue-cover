import { createHash, randomBytes } from 'node:crypto';

// 32 random bytes: a confirmation link or a session. The token is handed out once; only its hash is stored, so a copy of
// the database does not let anyone sign in.
export const newToken = (): string => randomBytes(32).toString('base64url');
export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');
