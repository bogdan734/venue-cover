import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { Database } from '../db/types.js';
import { principalOf, requireAuth } from '../modules/auth/index.js';
import type { SimulatedMail } from '../providers/mail.js';
import { HttpError } from './errors.js';

export const MailboxClaim = z.object({ address: z.email().max(320) });
const Query = z.object({ to: z.email().max(320) });

// No e-mail leaves this project, so a demo shows what would have arrived. Only a key without a program, holding the
// mail scope, reaches it: the web app, on behalf of the browser that claimed the address first.
export function registerMailbox(
  app: FastifyInstance,
  db: Kysely<Database>,
  mail: SimulatedMail,
): void {
  const operatorOnly = async (request: FastifyRequest) => {
    if (principalOf(request).programId !== null) {
      throw new HttpError(403, 'forbidden', 'the demo mailbox is for a key without a program');
    }
  };
  const preHandler = [requireAuth(db, 'mail:read'), operatorOnly];

  app.post('/v1/demo/mailboxes', { preHandler }, async (request, reply) => {
    const key = mail.claim(MailboxClaim.parse(request.body).address);
    if (!key) {
      throw new HttpError(409, 'mailbox_taken', 'another browser used this address first');
    }
    return reply.status(201).send({ key });
  });

  app.get('/v1/demo/mailbox', { preHandler }, async (request) => {
    const { to } = Query.parse(request.query);
    const key = request.headers['mailbox-key'];
    const messages = typeof key === 'string' ? mail.read(to, key) : null;
    if (!messages) throw new HttpError(403, 'not_your_mailbox', 'this mailbox has another key');
    return {
      messages: messages.map((m) => ({
        id: m.id,
        to: m.to,
        subject: m.subject,
        body: m.body,
        action: m.action ?? null,
        attachment: m.attachment?.filename ?? null,
        at: m.at.toISOString(),
      })),
    };
  });
}
