import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Database } from './types.js';

// Dates travel as plain 'YYYY-MM-DD' strings: no time zone can shift a calendar date.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

export interface DbOptions {
  /** Called with the SQL text of every query; tests use it to count queries. */
  onQuery?: (sql: string) => void;
}

export function createDb(connectionString: string, options: DbOptions = {}): Kysely<Database> {
  const { onQuery } = options;
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString, max: 10 }) }),
    ...(onQuery
      ? {
          log: (event) => {
            if (event.level === 'query') onQuery(event.query.sql);
          },
        }
      : {}),
  });
}
