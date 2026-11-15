import { generate } from '../../../../data/generate.js';
import { createDb } from '../db/client.js';
import { migrate } from '../db/migrate.js';
import { seedDatabase } from '../db/seed.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required (see .env.example)');

const db = createDb(databaseUrl);
try {
  await migrate(db);
  const existing = await db.selectFrom('broker').select('id').limit(1).execute();
  if (existing.length > 0) throw new Error('database already holds seed data; drop it first');
  await seedDatabase(db, generate(42));
  console.log('seeded');
} finally {
  await db.destroy();
}
