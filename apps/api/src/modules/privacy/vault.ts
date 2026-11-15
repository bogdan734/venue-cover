import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// What a tag stands for, sealed with AES-256-GCM. The record it belongs to is bound in as associated data, so a sealed
// vault copied onto another record does not open there.
export function seal(vault: Record<string, string>, key: Buffer, record: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(record));
  const body = Buffer.concat([cipher.update(JSON.stringify(vault), 'utf8'), cipher.final()]);
  return `v1.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url')}`;
}

export function open(sealed: string, key: Buffer, record: string): Record<string, string> {
  if (!sealed.startsWith('v1.')) throw new Error('not a sealed vault');
  const raw = Buffer.from(sealed.slice(3), 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAAD(Buffer.from(record));
  decipher.setAuthTag(raw.subarray(12, 28));
  const plain = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
  return JSON.parse(plain.toString('utf8')) as Record<string, string>;
}
