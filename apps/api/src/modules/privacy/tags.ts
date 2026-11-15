import { createHmac, hkdfSync } from 'node:crypto';
import type { PiiKind } from './detect.js';

export interface ProgramKeys {
  /** Makes the id in a tag. */
  tag: Buffer;
  /** Seals the originals. */
  seal: Buffer;
}

// Each client program gets its own keys, derived from one platform secret: the same person has unrelated tags in two
// programs, and one program's sealed originals do not open with another's key. A null program is the platform's own work
// (drafting a program that does not exist yet).
export function keysFor(secret: string, programId: string | null): ProgramKeys {
  if (secret.length < 16) throw new Error('the privacy secret must be at least 16 characters');
  const scope = programId ?? 'platform';
  const derive = (use: string) =>
    Buffer.from(hkdfSync('sha256', secret, 'venue-cover/privacy/v1', `${use}:${scope}`, 32));
  return { tag: derive('tag'), seal: derive('seal') };
}

// The same value written two ways is the same value: a phone number by its digits, an e-mail without case.
function normalise(kind: PiiKind, value: string): string {
  switch (kind) {
    case 'PHONE': {
      const digits = value.replace(/\D/g, '');
      return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
    }
    case 'CARD':
    case 'SIN':
    case 'ID':
      return value.replace(/\D/g, '');
    case 'POSTAL':
      return value.replace(/[\s-]/g, '').toUpperCase();
    default:
      return value.toLowerCase().replace(/\s+/g, ' ').replace(/\.$/, '').trim();
  }
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// `[NAME#7K3Q2A]`: the kind, and 30 bits of an HMAC of the value under the program's key. Opaque to the model, the same
// for the same value within a program, and of no use for finding the value without the key.
export function tagOf(kind: PiiKind, value: string, key: Buffer): string {
  const mac = createHmac('sha256', key)
    .update(`${kind}:${normalise(kind, value)}`)
    .digest();
  const bits = mac.readUInt32BE(0);
  let id = '';
  for (let i = 0; i < 6; i++) id += BASE32[(bits >>> (27 - 5 * i)) & 31];
  return `[${kind}#${id}]`;
}
