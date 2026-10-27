// Real local Supabase: a service-role client, fresh tenants, and sign-in capable users created
// through the auth admin API (Supabase testing docs). Credentials come from `supabase status`.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from '@dueloop/db';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { localEnv } from '../../db/scripts/local-env.ts';
import { commitImport, stageImport, type Client } from '../src/stage.ts';
import type { ImportOptions, Mapping } from '../src/types.ts';
import { validateFile } from '../src/validate.ts';
import { seeded } from '../test/random.ts';

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
export const fixtureBytes = (f: string) => new Uint8Array(readFileSync(path.join(fixtures, f)));
export const fixtureJson = <T>(f: string): T => JSON.parse(readFileSync(path.join(fixtures, f), 'utf8')) as T;

const noSession = { auth: { persistSession: false, autoRefreshToken: false } } as const;

export function serviceClient(): Client {
  const e = localEnv();
  return createClient<Database>(e.apiUrl, e.serviceRoleKey, noSession);
}

export function anonClient(): Client {
  const e = localEnv();
  return createClient<Database>(e.apiUrl, e.anonKey, noSession);
}

export async function sql<R extends pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<R[]> {
  const c = new pg.Client({ connectionString: localEnv().dbUrl });
  await c.connect();
  try {
    return (await c.query<R>(text, params)).rows;
  } finally {
    await c.end();
  }
}

export async function newTenant(currency = 'GBP', timezone = 'Europe/London'): Promise<string> {
  const id = randomUUID();
  await sql('insert into public.tenants (id, name, timezone, currency) values ($1, $2, $3, $4)', [id, `test ${id}`, timezone, currency]);
  return id;
}

/** Creates a confirmed user with a random password, signs in, and returns a user-scoped client. */
export async function signedInUser(tenantId: string | null, role: 'owner' | 'accountant' | 'collector' | null): Promise<{ id: string; client: Client }> {
  const email = `user-${randomUUID()}@dueloop.test`;
  const password = randomUUID();
  const admin = serviceClient();
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`createUser failed: ${created.error?.message}`);
  const id = created.data.user.id;
  if (tenantId && role) await sql('insert into public.memberships (tenant_id, user_id, role) values ($1, $2, $3)', [tenantId, id, role]);
  const e = localEnv();
  const client = createClient<Database>(e.apiUrl, e.anonKey, noSession);
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`sign-in failed: ${signIn.error.message}`);
  return { id, client };
}

export interface Counts {
  customers: number;
  invoices: number;
  events: number;
}

export async function counts(tenantId: string): Promise<Counts> {
  const [r] = await sql<{ customers: number; invoices: number; events: number }>(
    `select (select count(*)::int from public.customers where tenant_id = $1) as customers,
            (select count(*)::int from public.invoices where tenant_id = $1) as invoices,
            (select count(*)::int from public.invoice_events where tenant_id = $1) as events`,
    [tenantId],
  );
  if (!r) throw new Error('no counts');
  return r;
}

export interface ImportCase {
  file: string;
  mapping: string;
  options: string;
  bytes?: Uint8Array;
  seed?: number;
}

/** validate -> stage (with the given client) -> return the batch id and validation result. */
export async function stage(client: Client, tenantId: string, c: ImportCase, uploadedBy: string | null = null) {
  const bytes = c.bytes ?? fixtureBytes(c.file);
  const mapping = fixtureJson<Mapping>(`mappings/${c.mapping}.json`);
  const options = fixtureJson<ImportOptions>(`options/${c.options}.json`);
  const validation = validateFile(bytes, mapping, options, seeded(c.seed ?? 1));
  const staged = await stageImport(client, { tenantId, uploadedBy, fileName: c.file, bytes, mapping, options, validation });
  if (!staged.ok) throw new Error(`stage failed: ${staged.error}`);
  return { batchId: staged.batchId, validation };
}

export async function importFile(client: Client, tenantId: string, c: ImportCase, opts: { skipInvalidRows?: boolean; dryRun?: boolean } = {}) {
  const { batchId, validation } = await stage(client, tenantId, c);
  return { batchId, validation, result: await commitImport(client, batchId, opts) };
}
