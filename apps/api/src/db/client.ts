import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

type DbInstance = NodePgDatabase<typeof schema> & { $client: Pool };
export type DB = DbInstance;

export const DEFAULT_DATABASE_URL = 'postgres://ottodot:ottodot@localhost:5432/ottodot';

export function createDb(connectionString: string = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL): DbInstance {
  const pool = new Pool({ connectionString });
  return drizzle(pool, { schema });
}

let defaultDb: DB | null = null;
export function getDb(): DB {
  defaultDb ??= createDb();
  return defaultDb;
}
