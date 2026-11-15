import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { Database } from '../../db/types.js';
import { principalOf, requireAuth } from '../auth/index.js';
import { policyReportCsv } from './csv.js';
import { policyReportFor } from './service.js';

const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'a month is written YYYY-MM');
const PolicyReportQuery = z.object({
  month: Month,
  programId: z.string().min(1).optional(),
  format: z.enum(['json', 'csv']).default('json'),
});

export function registerReportRoutes(app: FastifyInstance, db: Kysely<Database>): void {
  app.get(
    '/v1/reports/policies',
    { preHandler: requireAuth(db, 'reports:read') },
    async (request, reply) => {
      const query = PolicyReportQuery.parse(request.query);
      const report = await policyReportFor(db, principalOf(request), query.month, query.programId);
      if (query.format === 'json') return report;
      const name = `policies-${query.month}${report.program ? `-${report.program.code}` : ''}.csv`;
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="${name}"`)
        .send(policyReportCsv(report));
    },
  );
}
