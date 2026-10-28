// Prompt 6, issue I: money columns are bigint. PostgREST sends them as JSON numbers, and JSON.parse rounds anything
// above 2^53. This test proves the loss on the plain read and shows that a `::text` cast in the select keeps every
// digit. The web app therefore always selects money as text and formats it with core's digitsToMajorString.
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/index.ts';
import { localEnv } from '../scripts/local-env.ts';
import { query } from './db.ts';

const T = '0b000000-0000-4000-8000-00000000000a';
const C = '0b000000-0000-4000-8000-0000000000ca';
const I = '0b000000-0000-4000-8000-0000000001aa';
const BIG = '9007199254740993'; // 2^53 + 1: the nearest double is ...992

describe('bigint over the Data API', () => {
  beforeAll(async () => {
    await query(`select private.purge_tenant($1)`, [T]).catch(() => undefined);
    await query(`insert into public.tenants (id, name, timezone, currency) values ($1, 'Big Co', 'UTC', 'USD')`, [T]);
    await query(`insert into public.customers (id, tenant_id, display_name) values ($1, $2, 'Big')`, [C, T]);
    await query(
      `insert into public.invoices (id, tenant_id, customer_id, number, amount_total, currency, issued_on, due_on, reference_code)
       values ($1, $2, $3, 'BIG-1', $4::bigint, 'USD', '2026-01-01', '2026-02-01', 'REFBIG01')`,
      [I, T, C, BIG],
    );
  });
  afterAll(async () => {
    await query(`select private.purge_tenant($1)`, [T]);
  });

  it('a plain select loses precision; a ::text select does not', async () => {
    const env = localEnv();
    const sb = createClient<Database>(env.apiUrl, env.serviceRoleKey, { auth: { persistSession: false } });
    const plain = await sb.from('invoices').select('amount_total').eq('id', I).single();
    expect(plain.error).toBeNull();
    expect(String(plain.data?.amount_total)).not.toBe(BIG); // the rounding this test exists to document
    expect(Number.isSafeInteger(plain.data?.amount_total)).toBe(false);

    const asText = await sb.from('invoice_list').select('amount_total::text, balance::text').eq('id', I).single();
    expect(asText.error).toBeNull();
    expect(asText.data?.amount_total).toBe(BIG);
    expect(asText.data?.balance).toBe(BIG);
  });
});
