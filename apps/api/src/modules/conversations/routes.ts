import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { HttpError } from '../../http/errors.js';
import { renterOf } from '../accounts/index.js';
import { idempotent, principalOf, requireAuth } from '../auth/index.js';
import { inbox, inboxDetail } from './inbox.js';
import {
  type ConversationDeps,
  canReadPersonal,
  conversationForKey,
  linesOf,
  receive,
  replyAsStaff,
  setState,
  startConversation,
} from './service.js';

export const MessageBody = z.object({ text: z.string().trim().min(1).max(2000) });
export const ConversationStateBody = z.object({ to: z.enum(['bot', 'human', 'closed']) });
const After = z.object({ after: z.iso.datetime().optional() });

const KEY_HEADER = 'conversation-key';
type ById = { Params: { id: string } };

function programOf(request: FastifyRequest): string {
  const { programId } = principalOf(request);
  if (!programId)
    throw new HttpError(403, 'forbidden', 'a conversation belongs to a program’s key');
  return programId;
}

const keyOf = (request: FastifyRequest) => {
  const key = request.headers[KEY_HEADER];
  return typeof key === 'string' ? key : undefined;
};

export function registerConversationRoutes(app: FastifyInstance, deps: ConversationDeps): void {
  const { db, clock } = deps;
  const write = requireAuth(db, 'quotes:write');
  const read = requireAuth(db, 'quotes:read');
  const manage = requireAuth(db, 'conversations:manage');

  // A portal opens a chat for a browser. The secret it gets back is the browser's proof on every later call.
  app.post('/v1/conversations', { preHandler: write }, async (request, reply) => {
    const programId = programOf(request);
    const opened = await idempotent(db, request, async (trx) => {
      const { conversation, key } = await startConversation({ ...deps, db: trx }, programId, 'web');
      return {
        id: conversation.id,
        key: key as string,
        state: conversation.state,
        messages: await linesOf(
          { ...deps, db: trx },
          conversation,
          canReadPersonal(principalOf(request)),
        ),
      };
    });
    return reply.status(201).send(opened);
  });

  app.post<ById>(
    '/v1/conversations/:id/messages',
    { preHandler: write },
    async (request, reply) => {
      const programId = programOf(request);
      const { text } = MessageBody.parse(request.body);
      const renter = await renterOf(db, request, clock());
      const answered = await idempotent(db, request, async (trx) => {
        const conversation = await conversationForKey(
          trx,
          programId,
          request.params.id,
          keyOf(request),
        );
        const { state, lines } = await receive(
          { ...deps, db: trx },
          conversation,
          text,
          renter?.id ?? null,
          canReadPersonal(principalOf(request)),
        );
        return { state, messages: lines };
      });
      return reply.status(201).send(answered);
    },
  );

  app.get<ById & { Querystring: { after?: string } }>(
    '/v1/conversations/:id',
    { preHandler: read },
    async (request) => {
      const { after } = After.parse(request.query);
      const conversation = await conversationForKey(
        db,
        programOf(request),
        request.params.id,
        keyOf(request),
      );
      return {
        id: conversation.id,
        state: conversation.state,
        messages: await linesOf(deps, conversation, canReadPersonal(principalOf(request)), after),
      };
    },
  );

  // Where else a renter can write: the Telegram bot, opened on this portal.
  app.get('/v1/channels', { preHandler: read }, async () => ({
    telegram: deps.telegram ? { username: deps.telegram.username } : null,
  }));

  app.get('/v1/inbox', { preHandler: manage }, async (request) => ({
    conversations: await inbox(deps, principalOf(request)),
  }));

  app.get<ById>('/v1/inbox/:id', { preHandler: manage }, async (request) =>
    inboxDetail(deps, principalOf(request), request.params.id),
  );

  app.post<ById>('/v1/inbox/:id/messages', { preHandler: manage }, async (request, reply) => {
    const { text } = MessageBody.parse(request.body);
    const line = await idempotent(db, request, (trx) =>
      replyAsStaff({ ...deps, db: trx }, principalOf(request), request.params.id, text),
    );
    return reply.status(201).send(line);
  });

  app.post<ById>('/v1/inbox/:id/state', { preHandler: manage }, async (request) => {
    const { to } = ConversationStateBody.parse(request.body);
    return idempotent(db, request, (trx) =>
      setState(trx, principalOf(request), request.params.id, to, clock()),
    );
  });
}
