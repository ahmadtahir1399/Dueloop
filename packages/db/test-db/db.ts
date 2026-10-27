// Test helpers for the real local database. Credentials come from `supabase status` at runtime.
import pg from 'pg';
import { localEnv } from '../scripts/local-env.ts';

export async function withClient<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: localEnv().dbUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function query<R extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<R[]> {
  return withClient(async (c) => (await c.query<R>(sql, params)).rows);
}
