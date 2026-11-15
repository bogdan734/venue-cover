import { describe, expect, it } from 'vitest';
import { SimulatedMail } from './mail.js';

const message = (n: number) => ({
  to: 'pat@example.org',
  subject: `Message ${n}`,
  body: '',
  idempotencyKey: `m-${n}`,
});

describe('the simulated mail', () => {
  // A public demo must not be able to fill the machine's memory by registering in a loop.
  it('keeps the newest 5000 messages', async () => {
    const mail = new SimulatedMail();
    for (let n = 1; n <= 5003; n++) await mail.send(message(n));
    expect(mail.sent).toHaveLength(5000);
    expect(mail.sent[0]?.subject).toBe('Message 4');
    expect(mail.sent.at(-1)?.id).toBe(5003);
  });

  it('sends a message with a key it has seen once', async () => {
    const mail = new SimulatedMail();
    await mail.send(message(1));
    await mail.send(message(1));
    expect(mail.sent).toHaveLength(1);
  });
});
