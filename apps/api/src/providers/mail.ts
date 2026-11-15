import { createHash, randomBytes } from 'node:crypto';

export interface MailMessage {
  to: string;
  subject: string;
  body: string;
  attachment?: { filename: string; bytes: Uint8Array };
  /** A message with a key that was already sent is dropped, so an at-least-once handler cannot send twice. */
  idempotencyKey: string;
  /** The one thing the reader is asked to do, shown as a button: a confirmation link, for instance. */
  action?: { label: string; url: string };
}

/** A message as the simulator kept it: numbered in the order it was sent. */
export type SentMail = MailMessage & { id: number; at: Date };

export interface MailProvider {
  send(message: MailMessage): Promise<void>;
}

const digest = (key: string) => createHash('sha256').update(key).digest('hex');
// How much mail a demo keeps in memory: plenty to read, and a ceiling for a visitor who registers in a loop.
const KEEP = 5000;
const normalise = (address: string) => address.trim().toLowerCase();

// No real e-mail leaves this project; the simulator keeps what would have been sent.
//
// It also stands in for owning a mailbox: the first browser to claim an address gets the one key that reads its mail.
// Without that, typing someone else's address would show their mail, confirmation links included.
export class SimulatedMail implements MailProvider {
  readonly sent: SentMail[] = [];
  private readonly keys = new Set<string>();
  // address → SHA-256 of its mailbox key
  private readonly owners = new Map<string, string>();
  private count = 0;

  /** A new key for the address's mailbox, or null when another browser claimed it first. */
  claim(address: string): string | null {
    const to = normalise(address);
    if (this.owners.has(to)) return null;
    const key = randomBytes(32).toString('base64url');
    this.owners.set(to, digest(key));
    return key;
  }

  /** The address's mail, newest first, for the holder of its key; null for anyone else. */
  read(address: string, key: string): SentMail[] | null {
    const to = normalise(address);
    if (this.owners.get(to) !== digest(key)) return null;
    return this.sent.filter((m) => normalise(m.to) === to).reverse();
  }

  async send(message: MailMessage): Promise<void> {
    if (this.keys.has(message.idempotencyKey)) return;
    this.keys.add(message.idempotencyKey);
    this.sent.push({ ...message, id: ++this.count, at: new Date() });
    while (this.sent.length > KEEP) {
      const oldest = this.sent.shift();
      if (oldest) this.keys.delete(oldest.idempotencyKey);
    }
  }
}
