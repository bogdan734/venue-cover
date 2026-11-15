import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

// Every failure leaves the API as { error: { code, message } }.
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      return reply
        .status(error.status)
        .send({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof ZodError) {
      const message = error.issues
        .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
        .join('; ');
      return reply.status(400).send({ error: { code: 'validation_error', message } });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status !== undefined && status >= 400 && status < 500) {
      // A GraphQL validation failure carries the reasons in `errors`; show them rather than the generic summary.
      const detail = (error as { errors?: { message?: string }[] }).errors
        ?.map((e) => e.message)
        .filter(Boolean)
        .join('; ');
      const message = detail || (error instanceof Error ? error.message : 'bad request');
      return reply.status(status).send({ error: { code: 'bad_request', message } });
    }
    app.log.error(error);
    return reply.status(500).send({ error: { code: 'internal_error', message: 'internal error' } });
  });
  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send({ error: { code: 'not_found', message: 'route not found' } }),
  );
}
