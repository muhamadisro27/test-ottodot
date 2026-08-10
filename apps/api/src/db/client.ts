import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

type DbInstance = NodePgDatabase<typeof schema> & { $client: Pool };
export type DB = DbInstance;

export const DEFAULT_DATABASE_URL = 'postgres://ottodot:ottodot@localhost:5432/ottodot';

export function createDb(connectionString: string = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL): DbInstance {
  const isVercel = process.env.VERCEL === '1';
  const pool = new Pool({
    connectionString,
    // Serverless functions can spin up many concurrent instances; keep the pool
    // tiny and fail fast instead of exhausting connections.
    ...(isVercel ? { max: 1, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30_000 } : {}),
  });
  return drizzle(pool, { schema });
}

let defaultDb: DB | null = null;
export function getDb(): DB {
  defaultDb ??= createDb();
  return defaultDb;
}
