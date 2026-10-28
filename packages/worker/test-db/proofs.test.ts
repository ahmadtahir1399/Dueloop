// Prompt 5 step 13: the proof inbox against the REAL database (trigger -> proof_fetch queue -> fetch from the
// stored raw email -> sniff -> private storage -> review task) and the human workflow (confirm / reject).
import { createHash, randomUUID } from 'node:crypto';
import {
  DEFAULT_PROOFS_CONFIG,
  FakeProofExtractor,
  MemoryProofStore,
  ProofsDb,
  confirmProof,
  createMediaFetcher,
  planProofConfirmation,
  processProofBatch,
  proofIdFor,
  rejectProof,
  supabaseProofStore,
  type ProofsDeps,
} from '@dueloop/proofs';
import { generateReferenceCode } from '@dueloop/ingest/parsers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { localEnv } from '../../db/scripts/local-env.ts';
import { jpeg, pdf, png } from '../../proofs/test/fixtures.ts';
import { pool, q, quietCron } from './harness.ts';
import { balanceOf, payWorld, statusOf, tasksOf, type PayWorld } from './payments-harness.ts';

beforeAll(quietCron);
afterAll(() => pool.end());

const proofsDb = new ProofsDb(pool);

/** A raw email (stored as prompt 4 stores it), its message row, and the link to the invoice (=> trigger). */
async function inboundEmail(w: PayWorld, files: { name: string; mime: string; bytes: Buffer }[], link = true): Promise<string> {
  const boundary = 'B0UND';
  const parts = files.flatMap((f) => [`--${boundary}`, `Content-Type: ${f.mime}; name="${f.name}"`, 'Content-Transfer-Encoding: base64', `Content-Disposition: attachment; filename="${f.name}"`, '', f.bytes.toString('base64')]);
  const raw = ['From: ada@customer.example', 'To: billing@test-co.example', 'Subject: paid', `Message-ID: <${randomUUID()}@customer.example>`, 'MIME-Version: 1.0', `Content-Type: multipart/mixed; boundary="${boundary}"`, '', `--${boundary}`, 'Content-Type: text/plain', '', 'Paid, see attached.', ...parts, `--${boundary}--`, ''].join('\r\n');
  const acct = (await q<{ id: string }>(`select id from public.channel_accounts where tenant_id = $1 and channel = 'email'`, [w.tenantId]))[0]?.id;
  const ev = await q<{ id: string }>(
    `insert into public.inbound_events (tenant_id, channel_account_id, provider, provider_event_id, kind, raw_mime, received_at, purge_after) values ($1, $2, 'imap', $3, 'message', $4, now(), now() + interval '90 days') returning id`,
    [w.tenantId, acct, randomUUID(), raw],
  );
  const msg = await q<{ id: string }>(
    `insert into public.messages (tenant_id, customer_id, channel, direction, provider_message_id, attachments, inbound_event_id, received_at) values ($1, $2, 'email', 'in', $3, $4, $5, now()) returning id`,
    [w.tenantId, w.customerId, randomUUID(), JSON.stringify(files.map((f) => ({ name: f.name, mime: f.mime, size: f.bytes.length }))), ev[0]?.id],
  );
  const id = msg[0]?.id ?? '';
  if (link) await q(`insert into public.message_invoices (tenant_id, message_id, invoice_id) values ($1, $2, $3)`, [w.tenantId, id, w.invoiceIds[0]]);
  return id;
}

function deps(w: PayWorld, over: Partial<ProofsDeps> = {}): ProofsDeps & { store: MemoryProofStore; extractor: FakeProofExtractor } {
  return {
    db: proofsDb,
    store: new MemoryProofStore(),
    media: createMediaFetcher({ graphVersion: '', tokenFor: async () => null }),
    extractor: new FakeProofExtractor(),
    clock: w.clock,
    logger: { info: (e) => w.logs.push(e), warn: (e) => w.logs.push(e) },
    notifier: w.notifier,
    config: DEFAULT_PROOFS_CONFIG,
    ...over,
  } as ProofsDeps & { store: MemoryProofStore; extractor: FakeProofExtractor };
}
const run = (d: ProofsDeps, w: PayWorld) => processProofBatch(d, { limit: 20, filter: { tenant_id: w.tenantId } });
const proofs = (tenantId: string) => q<{ id: string; status: string; mime: string; duplicate_of: string | null; hints: Record<string, unknown>; original_name: string | null; storage_path: string }>('select id, status, mime, duplicate_of, hints, original_name, storage_path from public.payment_proofs where tenant_id = $1 order by created_at, attachment_index', [tenantId]);

describe('proof inbox', () => {
  it('a linked message with a PNG and a PDF: both stored privately, one review task each, reminders blocked; a second job stores nothing', async () => {
    const w = await payWorld();
    const msg = await inboundEmail(w, [
      { name: '../../receipt.png', mime: 'image/png', bytes: png(40, 30) },
      { name: 'statement.pdf', mime: 'application/pdf', bytes: pdf() },
    ]);
    const d = deps(w);
    expect((await run(d, w)).outcomes).toEqual({ stored: 2 });
    const rows = await proofs(w.tenantId);
    expect(rows.map((r) => [r.mime, r.status, r.original_name])).toEqual([
      ['image/png', 'pending', 'receipt.png'],
      ['application/pdf', 'pending', 'statement.pdf'],
    ]);
    expect(rows[0]?.id).toBe(proofIdFor(msg, 0));
    expect(rows[0]?.storage_path).toBe(`${w.tenantId}/${rows[0]?.id}`);
    expect([...d.store.files.keys()].sort()).toEqual(rows.map((r) => r.storage_path).sort());
    expect((await tasksOf(w.tenantId)).filter((t) => t.type === 'review_proof')).toHaveLength(2);
    expect(d.extractor.calls).toEqual([]); // AI extraction is OFF by default
    expect((await q('select 1 from public.tasks where tenant_id = $1 and blocks_reminders_until > $2', [w.tenantId, w.clock.now()])).length).toBe(2);
    // Same message linked again (or the job redelivered): nothing new.
    await q(`insert into pgmq.q_proof_fetch (vt, message) values (now(), $1)`, [JSON.stringify({ tenant_id: w.tenantId, message_id: msg })]);
    expect((await run(d, w)).outcomes).toEqual({ skipped: 2 });
  });

  it('an unmatched message is never fetched (rule 24); invalid files are refused with a task and never stored', async () => {
    const w = await payWorld();
    await inboundEmail(w, [{ name: 'a.png', mime: 'image/png', bytes: png(4, 3) }], false);
    expect(await q(`select 1 from pgmq.q_proof_fetch where message ->> 'tenant_id' = $1`, [w.tenantId])).toEqual([]);
    await inboundEmail(w, [
      { name: 'evil.png', mime: 'image/png', bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>'.padEnd(80)) },
      { name: 'bomb.png', mime: 'image/png', bytes: png(50_000, 50_000) },
    ]);
    const d = deps(w);
    expect((await run(d, w)).outcomes).toEqual({ rejected: 2 });
    expect(await proofs(w.tenantId)).toEqual([]);
    expect(d.store.files.size).toBe(0);
    expect((await tasksOf(w.tenantId)).filter((t) => t.type === 'review_proof')).toHaveLength(2);
  });

  it('exact duplicates are flagged tenant-wide; extraction runs only with the tenant opt-in and stores labelled hints', async () => {
    const w = await payWorld();
    const ref = generateReferenceCode(() => 7);
    await q('update public.invoices set reference_code = $2 where id = $1', [w.invoiceIds[0], ref]);
    const img = jpeg(800, 600);
    const sha = createHash('sha256').update(img).digest('hex');
    await q('update public.tenants set proof_ai_extraction = true where id = $1', [w.tenantId]);
    const d = deps(w, { extractor: new FakeProofExtractor({ [sha]: { amountText: '£1,250.50', dateText: '2026-06-09', referenceText: ref, bankNameText: 'Bank' } }) });
    await inboundEmail(w, [{ name: 'p.jpg', mime: 'image/jpeg', bytes: img }]);
    await run(d, w);
    await inboundEmail(w, [{ name: 'same.jpg', mime: 'image/jpeg', bytes: img }]);
    expect((await run(d, w)).outcomes).toEqual({ stored: 1, duplicates: 1 });
    const [first, second] = await proofs(w.tenantId);
    expect(first?.hints).toMatchObject({ untrusted: true, amountMinor: 125050, dateIso: '2026-06-09', referenceValid: true, referenceMatchesInvoice: true });
    expect(second?.duplicate_of).toBe(first?.id);
    expect(second?.hints).toEqual({}); // never re-sent to the model
    expect(d.extractor.calls).toEqual([sha]);
    expect((await q<{ reason: string }>(`select reason from public.tasks where tenant_id = $1 and type = 'review_proof' order by created_at`, [w.tenantId])).map((t) => t.reason)).toEqual(['new_proof', 'possible_duplicate']);
  });

  it('caps: too many files in one message, the per-customer day, and the tenant storage total => tasks, not silent drops', async () => {
    const w = await payWorld();
    await inboundEmail(w, Array.from({ length: 7 }, (_, i) => ({ name: `${i}.png`, mime: 'image/png', bytes: png(4 + i, 3) })));
    const d = deps(w, { config: { ...DEFAULT_PROOFS_CONFIG, maxPerCustomerPerDay: 3 } });
    expect((await run(d, w)).outcomes).toEqual({ stored: 3, limited: 4 });
    const w2 = await payWorld();
    await q('update public.tenants set proof_storage_cap_bytes = 100 where id = $1', [w2.tenantId]);
    await inboundEmail(w2, [{ name: 'big.jpg', mime: 'image/jpeg', bytes: jpeg(100, 100) }]);
    expect((await run(deps(w2), w2)).outcomes).toEqual({ limited: 1 });
    expect((await q<{ reason: string }>(`select reason from public.tasks where tenant_id = $1 and type = 'proof_limit_reached'`, [w2.tenantId])).map((t) => t.reason)).toEqual(['storage_cap']);
    expect((await q<{ reason: string }>(`select reason from public.tasks where tenant_id = $1 and type = 'proof_limit_reached' order by reason`, [w.tenantId])).map((t) => t.reason)).toEqual(['customer_daily_limit', 'too_many_in_message']);
  });

  it('the real private bucket: upload, a time-limited signed URL, and no anonymous read', async () => {
    const w = await payWorld();
    const env = localEnv();
    const store = supabaseProofStore(env.apiUrl, env.serviceRoleKey);
    await inboundEmail(w, [{ name: 'r.png', mime: 'image/png', bytes: png(10, 10) }]);
    expect((await run(deps(w, { store }), w)).outcomes).toEqual({ stored: 1 });
    const p = (await proofs(w.tenantId))[0];
    const signed = await store.signedUrl(p?.storage_path ?? '', 60);
    expect(signed).toMatch(/token=/);
    const got = await fetch(signed);
    expect(got.status).toBe(200);
    expect(Buffer.from(await got.arrayBuffer()).equals(png(10, 10))).toBe(true);
    const anon = await fetch(`${env.apiUrl}/storage/v1/object/public/payment-proofs/${p?.storage_path}`);
    expect(anon.status).toBeGreaterThanOrEqual(400);
  });
});

describe('proof workflow', () => {
  async function pendingProof() {
    const w = await payWorld();
    await q(`insert into public.tasks (tenant_id, type, invoice_id, dedupe_key, created_at, blocks_reminders_until) values ($1, 'verify_payment_claim', $2, 'claim', now(), now() + interval '3 days')`, [w.tenantId, w.invoiceIds[0]]);
    await inboundEmail(w, [{ name: 'r.png', mime: 'image/png', bytes: png(10, 10) }]);
    await run(deps(w), w);
    const id = (await proofs(w.tenantId))[0]?.id ?? '';
    return { w, id };
  }

  it('confirm requires amount + date + bank ref from the human and goes through the pipeline (source proof)', async () => {
    const { w, id } = await pendingProof();
    const base = { proofId: id, amount: '1250.50', date: '2026-06-09', bankRef: 'BANK-777', user: w.ownerId };
    const plan = await planProofConfirmation(proofsDb, w.pdeps(), base);
    if (!plan.ok) throw new Error(plan.refusal);
    expect(plan.plan.plan).toMatchObject({ applied: 125050, transition: { to: 'paid' } });
    expect(await confirmProof(proofsDb, w.pdeps(), id, plan, null)).toMatchObject({ outcome: 'applied' });
    expect(await statusOf(w.invoiceIds[0] ?? '')).toBe('paid');
    expect(await balanceOf(w.invoiceIds[0] ?? '')).toBe(0);
    expect((await q<{ source: string; provider_ref: string; proof_id: string }>('select source, provider_ref, proof_id from public.receipts where tenant_id = $1', [w.tenantId]))[0]).toEqual({ source: 'proof', provider_ref: 'BANK-777', proof_id: id });
    expect((await proofs(w.tenantId))[0]?.status).toBe('confirmed');
    expect((await tasksOf(w.tenantId)).filter((t) => t.status === 'open')).toEqual([]);
    expect(await planProofConfirmation(proofsDb, w.pdeps(), base)).toEqual({ ok: false, refusal: 'proof already confirmed' });
  });

  it('with no bank ref the reference is proof:<id>, so the same proof can never pay twice; a collector cannot confirm', async () => {
    const { w, id } = await pendingProof();
    const col = randomUUID();
    await q(`insert into auth.users (id, email) values ($1, $2)`, [col, `c-${col.slice(0, 6)}@test-co.example`]);
    await q(`insert into public.memberships (tenant_id, user_id, role) values ($1, $2, 'collector')`, [w.tenantId, col]);
    expect(await planProofConfirmation(proofsDb, w.pdeps(), { proofId: id, amount: '100', date: '2026-06-09', bankRef: '', user: col })).toMatchObject({ ok: false, refusal: expect.stringMatching(/collector/) });
    const p = await planProofConfirmation(proofsDb, w.pdeps(), { proofId: id, amount: '100', date: '2026-06-09', bankRef: '', user: w.ownerId });
    if (!p.ok) throw new Error(p.refusal);
    expect(p.plan.bankRef).toBe(`proof:${id}`);
    await confirmProof(proofsDb, w.pdeps(), id, p, null);
    expect(await w.manual(0, 100, `proof:${id}`)).toMatchObject({ outcome: 'duplicate' });
  });

  it('reject needs a reason and a deciding role, resolves the claim task and lets reminders resume with one alert', async () => {
    const { w, id } = await pendingProof();
    expect(await rejectProof(proofsDb, w.pdeps(), id, w.ownerId, '')).toEqual({ ok: false, refusal: 'a reason is required' });
    expect(await rejectProof(proofsDb, w.pdeps(), id, w.ownerId, 'screenshot is for another invoice')).toEqual({ ok: true });
    expect((await proofs(w.tenantId))[0]?.status).toBe('rejected');
    expect((await tasksOf(w.tenantId)).filter((t) => t.status === 'open')).toEqual([]);
    expect(w.notifier.alerts.filter((a) => a.kind === 'proof_rejected')).toHaveLength(1);
    expect(await rejectProof(proofsDb, w.pdeps(), id, w.ownerId, 'again')).toEqual({ ok: false, refusal: 'proof already rejected' });
    const r = await w.run();
    expect(r.outcomes).toMatchObject({ sent: 1 }); // the reminder goes again
  });
});
