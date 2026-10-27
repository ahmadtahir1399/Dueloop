// Import commit against the REAL local database.
import { describe, expect, it } from 'vitest';
import { commitImport } from '../src/stage.ts';
import { anonClient, counts, importFile, newTenant, serviceClient, signedInUser, sql, stage } from './helpers.ts';

const service = serviceClient();
const CLEAN = { file: 'clean.csv', mapping: 'standard', options: 'gb-ymd' };
const EU = { file: 'messy-eu.csv', mapping: 'eu', options: 'de-dmy' };
const DUPES = { file: 'duplicates.csv', mapping: 'standard', options: 'pk-dmy' };
const header = 'invoice_no,customer,email,phone,amount,currency,issued,due,customer_id,status';
const csv = (...lines: string[]) => new TextEncoder().encode([header, ...lines].join('\n'));

describe('commit_import_batch', () => {
  it('IDEMPOTENT: the same file twice leaves customers, invoices and invoice_events unchanged', async () => {
    const t = await newTenant();
    const first = await importFile(service, t, CLEAN);
    expect(first.result).toMatchObject({ ok: true, counts: { invoices: { created: 3, skipped: 1 }, customers: { created: 2 } } });
    const after1 = await counts(t);
    const second = await importFile(service, t, CLEAN);
    expect(second.result).toMatchObject({ ok: true, counts: { invoices: { created: 0, updated: 0, unchanged: 3 }, customers: { created: 0, updated: 0 } } });
    expect(await counts(t)).toEqual(after1);
    expect(after1).toEqual({ customers: 2, invoices: 3, events: 3 });
  });

  it('a file with invalid rows is refused as a whole and nothing changes; skipInvalidRows imports the rest', async () => {
    const t = await newTenant('EUR', 'Europe/Berlin');
    const before = await counts(t);
    const refused = await importFile(service, t, EU);
    expect(refused.result).toMatchObject({ ok: false });
    expect(await counts(t)).toEqual(before);
    const [batch] = await sql<{ status: string }>('select status from public.import_batches where id = $1', [refused.batchId]);
    expect(batch?.status).toBe('staged');
    const ok = await commitImport(service, refused.batchId, { skipInvalidRows: true });
    expect(ok).toMatchObject({ ok: true, counts: { invoices: { created: 3, errored: 1 } } });
  });

  it('a commit that fails midway rolls back completely (no half import)', async () => {
    const t = await newTenant();
    const { batchId, validation } = await stage(service, t, CLEAN);
    // Take every reference-code candidate of the LAST importable row, so the commit fails on that row.
    const last = [...validation.rows].reverse().find((r) => r.outcome.kind === 'ok');
    const codes = last?.outcome.kind === 'ok' ? last.outcome.row.referenceCodes : [];
    const [c] = await sql<{ id: string }>(`insert into public.customers (tenant_id, display_name) values ($1, 'blocker') returning id`, [t]);
    for (const [i, code] of codes.entries()) {
      await sql(
        `insert into public.invoices (tenant_id, customer_id, number, amount_total, currency, issued_on, due_on, reference_code)
         values ($1, $2, $3, 1, 'GBP', '2026-01-01', '2026-01-02', $4)`,
        [t, c?.id, `BLOCK-${i}`, code],
      );
    }
    const before = await counts(t);
    const r = await commitImport(service, batchId);
    expect(r).toMatchObject({ ok: false });
    expect(r.ok ? '' : r.error).toContain('every reference code candidate is already taken');
    expect(await counts(t)).toEqual(before);
  });

  it('a reference-code clash is retried with the next candidate', async () => {
    const t = await newTenant();
    const { batchId, validation } = await stage(service, t, CLEAN);
    const first = validation.rows[0]?.outcome;
    const codes = first?.kind === 'ok' ? first.row.referenceCodes : [];
    const [c] = await sql<{ id: string }>(`insert into public.customers (tenant_id, display_name) values ($1, 'x') returning id`, [t]);
    await sql(
      `insert into public.invoices (tenant_id, customer_id, number, amount_total, currency, issued_on, due_on, reference_code)
       values ($1, $2, 'TAKEN', 1, 'GBP', '2026-01-01', '2026-01-02', $3)`,
      [t, c?.id, codes[0]],
    );
    expect(await commitImport(service, batchId)).toMatchObject({ ok: true });
    const [row] = await sql<{ reference_code: string }>(`select reference_code from public.invoices where tenant_id = $1 and number = 'INV-1001'`, [t]);
    expect(row?.reference_code).toBe(codes[1]);
  });

  it('dry run reports the same counts as the real commit and writes nothing', async () => {
    const t = await newTenant();
    const before = await counts(t);
    const dry = await importFile(service, t, CLEAN, { dryRun: true });
    expect(await counts(t)).toEqual(before);
    const [b] = await sql<{ status: string }>('select status from public.import_batches where id = $1', [dry.batchId]);
    expect(b?.status).toBe('staged');
    const real = await commitImport(service, dry.batchId);
    expect(dry.result.ok && real.ok && { ...dry.result.counts, dryRun: false }).toEqual(real.ok && real.counts);
  });

  it('a committed batch cannot be committed again', async () => {
    const t = await newTenant();
    const { batchId } = await importFile(service, t, CLEAN);
    expect(await commitImport(service, batchId)).toMatchObject({ ok: false });
  });

  it('new invoices are open, due now (issue H), and get an InvoiceImported event', async () => {
    const t = await newTenant();
    await importFile(service, t, CLEAN);
    const rows = await sql<{ status: string; due: boolean; events: number }>(
      `select i.status, exists (select 1 from public.invoices_due d where d.id = i.id) as due,
              (select count(*)::int from public.invoice_events e where e.invoice_id = i.id and e.type = 'InvoiceImported') as events
       from public.invoices i where i.tenant_id = $1`,
      [t],
    );
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r).toEqual({ status: 'open', due: true, events: 1 });
  });

  it('existing invoices: only real changes update (with an event); final invoices and totals below paid are left alone', async () => {
    const t = await newTenant();
    await importFile(service, t, { file: 'x.csv', mapping: 'standard', options: 'gb-ymd', bytes: csv(
      'U-1,Upd Ltd,u@example.com,,100.00,GBP,2026-09-01,2026-10-01,,Open',
      'U-2,Upd Ltd,u@example.com,,200.00,GBP,2026-09-01,2026-10-01,,Open',
      'U-3,Upd Ltd,u@example.com,,300.00,GBP,2026-09-01,2026-10-01,,Open',
      'U-4,Upd Ltd,u@example.com,,400.00,GBP,2026-09-01,2026-10-01,,Open',
    ) });
    // U-3 is paid in full (final); U-4 has 150.00 confirmed.
    await sql(`insert into public.payments (tenant_id, invoice_id, amount, currency, method, provider_ref, paid_at)
               select tenant_id, id, 30000, 'GBP', 'bank_transfer', 'P-U3', now() from public.invoices where tenant_id = $1 and number = 'U-3'`, [t]);
    await sql(`update public.invoices set status = 'paid' where tenant_id = $1 and number = 'U-3'`, [t]);
    await sql(`insert into public.payments (tenant_id, invoice_id, amount, currency, method, provider_ref, paid_at)
               select tenant_id, id, 15000, 'GBP', 'bank_transfer', 'P-U4', now() from public.invoices where tenant_id = $1 and number = 'U-4'`, [t]);
    const eventsBefore = (await counts(t)).events;

    const second = await importFile(service, t, { file: 'x2.csv', mapping: 'standard', options: 'gb-ymd', seed: 2, bytes: csv(
      'U-1,Upd Ltd,u@example.com,,100.00,GBP,2026-09-01,2026-10-01,,Open', // unchanged
      'U-2,Upd Ltd,u@example.com,,250.00,GBP,2026-09-01,2026-11-01,,Open', // total + due date changed
      'U-3,Upd Ltd,u@example.com,,999.00,GBP,2026-09-01,2026-12-01,,Open', // final: ignored
      'U-4,Upd Ltd,u@example.com,,100.00,GBP,2026-09-01,2026-10-01,,Open', // below the 150.00 paid: refused
    ) });
    expect(second.result).toMatchObject({ ok: true, counts: { invoices: { created: 0, updated: 1, unchanged: 2, skipped: 1 } } });
    expect(second.result.ok && second.result.counts.warnings.map((w) => w.code)).toEqual(['total_below_paid']);
    const inv = await sql<{ number: string; amount_total: string; due_on: string; status: string }>(
      `select number, amount_total, to_char(due_on, 'YYYY-MM-DD') as due_on, status from public.invoices where tenant_id = $1 order by number`, [t]);
    expect(inv.map((r) => [r.number, Number(r.amount_total), r.due_on, r.status])).toEqual([
      ['U-1', 10000, '2026-10-01', 'open'],
      ['U-2', 25000, '2026-11-01', 'open'],
      ['U-3', 30000, '2026-10-01', 'paid'],
      ['U-4', 40000, '2026-10-01', 'open'],
    ]);
    const events = await sql<{ type: string; payload: { changes: Record<string, unknown> } }>(
      `select type, payload from public.invoice_events where tenant_id = $1 and type = 'InvoiceImportUpdated'`, [t]);
    expect(events).toHaveLength(1);
    expect(Object.keys(events[0]?.payload.changes ?? {}).sort()).toEqual(['amountTotal', 'dueOn']);
    expect((await counts(t)).events).toBe(eventsBefore + 1);
  });

  it('existing customers: empty contact fields are filled, differing ones are kept and reported', async () => {
    const t = await newTenant();
    await sql(`insert into public.customers (tenant_id, display_name, email, external_id) values ($1, 'Acme Ltd', 'old@acme.example', 'C-001')`, [t]);
    const r = await importFile(service, t, CLEAN);
    expect(r.result).toMatchObject({ ok: true, counts: { customers: { created: 1, updated: 1 } } });
    const [acme] = await sql<{ email: string; phone_e164: string | null }>(
      `select email, phone_e164 from public.customers where tenant_id = $1 and external_id = 'C-001'`, [t]);
    expect(acme).toEqual({ email: 'old@acme.example', phone_e164: '+442079460958' });
    expect(r.result.ok && r.result.counts.warnings.some((w) => w.code === 'customer_details_differ')).toBe(true);
  });

  it('three phone formats -> ONE customer; two "John Smith"s with different emails stay TWO', async () => {
    const t = await newTenant('PKR', 'Asia/Karachi');
    const r = await importFile(service, t, DUPES, { skipInvalidRows: true });
    expect(r.result).toMatchObject({ ok: true });
    const byName = await sql<{ display_name: string; n: number }>(
      `select display_name, count(*)::int as n from public.customers where tenant_id = $1 group by 1 order by 1`, [t]);
    expect(byName).toEqual([
      { display_name: 'ACME', n: 1 }, // D-7 and D-8 share billing@acme.example (case-insensitive) -> one customer
      { display_name: 'Imran Traders', n: 1 },
      { display_name: 'John Smith', n: 2 },
    ]);
    const [imran] = await sql<{ invoices: number }>(
      `select count(*)::int as invoices from public.invoices i join public.customers c on c.id = i.customer_id
       where c.tenant_id = $1 and c.display_name = 'Imran Traders'`, [t]);
    expect(imran?.invoices).toBe(3);
  });

  it('two simultaneous commits of overlapping files create no duplicates', async () => {
    const t = await newTenant();
    const a = await stage(service, t, CLEAN);
    const b = await stage(serviceClient(), t, { file: 'x.csv', mapping: 'standard', options: 'gb-ymd', seed: 9, bytes: csv(
      'INV-1001,Acme Ltd,accounts@acme.example,,1250.00,GBP,2026-09-01,2026-10-01,C-001,Open',
      'INV-2001,Acme Ltd,accounts@acme.example,,10.00,GBP,2026-09-01,2026-10-01,C-001,Open',
      'INV-2002,New Co,new@co.example,,20.00,GBP,2026-09-01,2026-10-01,,Open',
    ) });
    const [ra, rb] = await Promise.all([commitImport(service, a.batchId), commitImport(serviceClient(), b.batchId)]);
    expect(ra.ok && rb.ok).toBe(true);
    const dupes = await sql<{ n: number }>(
      `select count(*)::int as n from (select external_id from public.customers where tenant_id = $1 and external_id is not null
                                       group by 1 having count(*) > 1) q`, [t]);
    expect(dupes[0]?.n).toBe(0);
    expect(await counts(t)).toMatchObject({ customers: 3, invoices: 5 });
  });
});

describe('commit permissions (real signed-in clients through PostgREST)', () => {
  it('owner and accountant may commit; collector, another tenant and anon may not', async () => {
    const t = await newTenant();
    const other = await newTenant();
    const accountant = await signedInUser(t, 'accountant');
    const collector = await signedInUser(t, 'collector');
    const outsider = await signedInUser(other, 'owner');

    const staged = await stage(service, t, CLEAN);
    for (const who of [collector.client, outsider.client, anonClient()]) {
      const r = await commitImport(who, staged.batchId);
      expect(r.ok).toBe(false);
    }
    expect(await counts(t)).toMatchObject({ invoices: 0 });
    const r = await commitImport(accountant.client, staged.batchId);
    expect(r).toMatchObject({ ok: true, counts: { invoices: { created: 3 } } });
  });

  it('an accountant can stage through RLS; a collector cannot even stage', async () => {
    const t = await newTenant();
    const accountant = await signedInUser(t, 'accountant');
    const collector = await signedInUser(t, 'collector');
    await expect(stage(collector.client, t, CLEAN, collector.id)).rejects.toThrow(/stage failed/);
    const s = await stage(accountant.client, t, CLEAN, accountant.id);
    expect(await commitImport(accountant.client, s.batchId)).toMatchObject({ ok: true });
  });

  it('user A cannot read tenant B through the API; anon reads nothing', async () => {
    const a = await newTenant();
    const b = await newTenant();
    await importFile(service, b, CLEAN);
    const owner = await signedInUser(a, 'owner');
    const fromA = await owner.client.from('invoices').select('id').eq('tenant_id', b);
    expect(fromA.error).toBeNull();
    expect(fromA.data).toEqual([]);
    const fromAnon = await anonClient().from('invoices').select('id');
    expect(fromAnon.data ?? []).toEqual([]);
  });
});
