import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const BASE_URL = process.env.DATABASE_URL ?? 'postgres://ottodot:ottodot@localhost:5432/ottodot';
const TEST_DB_NAME = 'ottodot_test';

export default async function globalSetup(): Promise<void> {
  const base = new URL(BASE_URL);
  const testUrl = new URL(BASE_URL);
  testUrl.pathname = `/${TEST_DB_NAME}`;

  const admin = new Pool({ connectionString: base.toString() });
  try {
    const res = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [TEST_DB_NAME]);
    if (res.rowCount === 0) {
      await admin.query(`CREATE DATABASE "${TEST_DB_NAME}"`);
    }
  } finally {
    await admin.end();
  }

  const pool = new Pool({ connectionString: testUrl.toString() });
  const db = drizzle(pool);
  try {
    await migrate(db, { migrationsFolder: './drizzle' });
  } finally {
    await pool.end();
  }
}
