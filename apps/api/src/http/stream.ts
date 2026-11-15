import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import { principalOf, requireAuth } from '../modules/auth/index.js';
import { eventsSince, latestSeq } from '../modules/events/index.js';

const POLL_MS = 400;
const HEARTBEAT_MS = 15_000;
const BATCH = 100;

// A server-sent events feed of the outbox for the caller's program (every program for a key without one). Each frame's
// id is the outbox sequence number, so a client that reconnects with Last-Event-ID continues where it stopped.
// Frames appear only after the transaction that produced the event has committed, because that is when the row
// becomes visible. By default a connection starts at the live end and replays nothing.
export function registerEventStream(app: FastifyInstance, db: Kysely<Database>): void {
  const open = new Set<() => void>();
  app.addHook('onClose', async () => {
    for (const hangUp of [...open]) hangUp();
  });

  app.get(
    '/v1/events/stream',
    { preHandler: requireAuth(db, 'quotes:read') },
    async (request, reply) => {
      const programId = principalOf(request).programId;
      const resumeFrom = Number(request.headers['last-event-id']);
      let after =
        Number.isInteger(resumeFrom) && resumeFrom >= 0 ? resumeFrom : await latestSeq(db);

      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      raw.write(': connected\n\n');

      let closed = false;
      const hangUp = () => {
        closed = true;
        open.delete(hangUp);
        raw.end();
      };
      open.add(hangUp);
      request.raw.on('close', () => {
        closed = true;
        open.delete(hangUp);
      });

      let lastWrite = Date.now();
      while (!closed) {
        try {
          const events = await eventsSince(db, after, programId, BATCH);
          for (const { seq, event } of events) {
            raw.write(`id: ${seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
            after = seq;
            lastWrite = Date.now();
          }
          if (events.length === 0 && Date.now() - lastWrite > HEARTBEAT_MS) {
            raw.write(': keep-alive\n\n');
            lastWrite = Date.now();
          }
        } catch (error) {
          app.log.error(error);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
      if (!raw.writableEnded) raw.end();
    },
  );
}
