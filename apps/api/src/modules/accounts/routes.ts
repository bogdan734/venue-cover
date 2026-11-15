import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from '../../db/types.js';
import { HttpError } from '../../http/errors.js';
import type { MailProvider } from '../../providers/mail.js';
import { principalOf, requireAuth } from '../auth/index.js';
import { getProgram } from '../programs/index.js';
import {
  confirm,
  type LinkTo,
  RegisterBody,
  ResendBody,
  register,
  requireRenter,
  resendConfirmation,
  SESSION_HEADER,
  SignInBody,
  signIn,
  signOut,
  VerifyBody,
} from './service.js';

export interface AccountRouteDeps {
  db: Kysely<Database>;
  mail: MailProvider;
  clock: () => Date;
  /** The web app's address, for absolute links in e-mails; links are relative to the site without it. */
  publicWebUrl?: string;
}

export function registerAccountRoutes(app: FastifyInstance, deps: AccountRouteDeps): void {
  const { db, mail, clock } = deps;
  const write = requireAuth(db, 'quotes:write');
  const read = requireAuth(db, 'quotes:read');

  // Links in e-mails point at the portal of the program whose key made the request.
  async function linkFor(request: FastifyRequest): Promise<LinkTo> {
    const programId = principalOf(request).programId;
    if (!programId)
      throw new HttpError(403, 'forbidden', 'accounts are opened through a program’s portal key');
    const program = await getProgram(db, programId);
    if (!program) throw new Error(`program ${programId} of the API key does not exist`);
    return (path) => `${deps.publicWebUrl ?? ''}/p/${program.code}${path}`;
  }

  // Mail is sent after the transaction commits, so a link is never sent for an account that was not saved.
  const send = async (message: Awaited<ReturnType<typeof register>>) => {
    if (message) await mail.send(message);
  };

  app.post('/v1/renters', { preHandler: write }, async (request, reply) => {
    const body = RegisterBody.parse(request.body);
    await send(await register(db, body, await linkFor(request), clock()));
    return reply.status(202).send({ status: 'check_your_email' });
  });

  app.post('/v1/renters/verification', { preHandler: write }, async (request, reply) => {
    const { email } = ResendBody.parse(request.body);
    await send(await resendConfirmation(db, email, await linkFor(request), clock()));
    return reply.status(202).send({ status: 'check_your_email' });
  });

  app.post('/v1/renters/verify', { preHandler: write }, async (request) =>
    confirm(db, VerifyBody.parse(request.body).token, clock()),
  );

  app.post('/v1/renters/sessions', { preHandler: write }, async (request) =>
    signIn(db, SignInBody.parse(request.body), clock()),
  );

  app.delete('/v1/renters/sessions/current', { preHandler: write }, async (request, reply) => {
    await requireRenter(db, request, clock());
    await signOut(db, request.headers[SESSION_HEADER] as string, clock());
    return reply.status(204).send();
  });

  app.get('/v1/renters/me', { preHandler: read }, async (request) =>
    requireRenter(db, request, clock()),
  );
}
