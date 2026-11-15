import { createHash } from 'node:crypto';
import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { HttpError } from '../../http/errors.js';
import { principalOf, requireAuth, withIdempotency } from '../auth/index.js';
import { ATTACHMENT_KINDS, type AttachmentKind } from './completeness.js';
import {
  getSubmission,
  type ReceivedAttachment,
  receiveSubmission,
  type SubmissionDeps,
} from './service.js';

const MAX_FILE_BYTES = 8 * 1024 * 1024;

export function registerSubmissionRoutes(app: FastifyInstance, deps: SubmissionDeps): void {
  const { db } = deps;
  const guard = requireAuth(db, 'quotes:write');
  app.register(multipart, { limits: { fileSize: MAX_FILE_BYTES, files: 8, fields: 0 } });

  // The upload is a multipart request: the form in a part named `form`, each supporting document in a part named after
  // its kind. The body is read before the idempotency check, so the key is bound to a hash of what was sent.
  app.post('/v1/submissions', { preHandler: guard }, async (request, reply) => {
    const key = request.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length === 0 || key.length > 200) {
      throw new HttpError(
        400,
        'idempotency_key_required',
        'send an Idempotency-Key header (1 to 200 characters)',
      );
    }
    let form: Buffer | undefined;
    const attachments: ReceivedAttachment[] = [];
    for await (const part of request.parts()) {
      if (part.type !== 'file')
        throw new HttpError(400, 'unexpected_part', `unexpected field ${part.fieldname}`);
      const bytes = await part.toBuffer();
      if (part.fieldname === 'form') {
        form = bytes;
      } else if ((ATTACHMENT_KINDS as readonly string[]).includes(part.fieldname)) {
        attachments.push({
          kind: part.fieldname as AttachmentKind,
          filename: part.filename,
          size: bytes.length,
        });
      } else {
        throw new HttpError(400, 'unexpected_part', `unexpected part ${part.fieldname}`);
      }
    }
    if (form?.subarray(0, 4).toString('latin1') !== '%PDF') {
      throw new HttpError(400, 'not_a_pdf', 'send the application as a PDF in a part named form');
    }

    const hash = createHash('sha256')
      .update(form)
      .update(JSON.stringify(attachments))
      .digest('hex');
    const view = await withIdempotency(db, principalOf(request).keyId, key, hash, (trx) =>
      receiveSubmission(deps, trx, principalOf(request), { form, attachments }),
    );
    return reply.status(201).send(view);
  });

  app.get<{ Params: { id: string } }>(
    '/v1/submissions/:id',
    { preHandler: requireAuth(db, 'quotes:read') },
    async (request) => getSubmission(db, principalOf(request), request.params.id),
  );
}
