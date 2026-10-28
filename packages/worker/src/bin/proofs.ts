// pnpm proofs list [--tenant <t>] [--status pending|confirmed|rejected|all]
//             show <proof id>                      signed URL (5 minutes), UNTRUSTED hints, duplicates, balance
//             confirm <proof id> --amount <text> --date <YYYY-MM-DD> (--bank-ref <ref> | --no-bank-ref) --user <email|id> [--yes]
//             reject <proof id> --reason "..." --user <email|id>
// The amount, date and bank reference are ALWAYS typed by the human; hints are never used as defaults.
import { confirmProof, planProofConfirmation, rejectProof } from '@dueloop/proofs';
import { parseArgs } from 'node:util';
import { buildPaymentsDeps, buildProofsDeps, clockFrom, openDb, resolveTenant } from '../runtime.ts';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    tenant: { type: 'string' },
    status: { type: 'string', default: 'pending' },
    amount: { type: 'string' },
    date: { type: 'string' },
    'bank-ref': { type: 'string' },
    'no-bank-ref': { type: 'boolean', default: false },
    user: { type: 'string' },
    reason: { type: 'string' },
    note: { type: 'string' },
    yes: { type: 'boolean', default: false },
    now: { type: 'string' },
  },
});
class Usage extends Error {}
const [cmd, id] = positionals;
const db = openDb(process.env);
const clock = clockFrom(values.now);
const proofs = buildProofsDeps(process.env, db, clock);
const pay = buildPaymentsDeps(process.env, db, clock);
const out = (o: unknown) => process.stdout.write(`${JSON.stringify(o, null, 2)}\n`);
const USAGE = 'usage: pnpm proofs list [--tenant] [--status] | show <id> | confirm <id> --amount --date (--bank-ref <ref> | --no-bank-ref) --user [--yes] | reject <id> --reason --user';

try {
  if (cmd === 'list') {
    const tenant = values.tenant ? await resolveTenant(db, values.tenant) : null;
    const rows = await proofs.db.list(tenant, values.status ?? 'pending');
    console.table(rows.map((p) => ({ id: p.id, invoice: p.invoiceId, mime: p.mime, size: p.sizeBytes, status: p.status, duplicateOf: p.duplicateOf, hints: Object.keys(p.hints).length ? 'yes (untrusted)' : 'none', at: p.createdAt.toISOString() })));
  } else if (cmd === 'show' && id) {
    const p = await proofs.db.get(id);
    if (!p) throw new Error('proof not found');
    const balance = p.invoiceId ? await proofs.db.balance(p.tenantId, p.invoiceId) : null;
    out({
      id: p.id,
      status: p.status,
      invoiceId: p.invoiceId,
      invoiceBalanceMinor: balance?.balance ?? null,
      invoiceStatus: balance?.status ?? null,
      file: { mime: p.mime, sizeBytes: p.sizeBytes, name: p.originalName, sha256: p.sha256 },
      duplicateOf: p.duplicateOf,
      viewUrl: { url: await proofs.store.signedUrl(p.storagePath, 300), expiresInSeconds: 300 },
      UNTRUSTED_HINTS: Object.keys(p.hints).length ? p.hints : null,
      note: 'Hints were read from the image by software and may be wrong or manipulated. Type the amount, date and bank reference from your bank statement.',
    });
  } else if (cmd === 'confirm' && id) {
    if (!values.amount || !values.date || !values.user || (values['bank-ref'] === undefined) === !values['no-bank-ref']) throw new Usage();
    const plan = await planProofConfirmation(proofs.db, pay, { proofId: id, amount: values.amount, date: values.date, bankRef: values['no-bank-ref'] ? '' : (values['bank-ref'] ?? ''), user: values.user });
    if (!plan.ok) {
      out({ result: 'refused', reason: plan.refusal });
      process.exitCode = 1;
    } else {
      const p = plan.plan;
      const summary = { invoice: p.invoice.number, currency: p.invoice.currency, balance: p.invoice.balanceMinor, amount: p.amountMinor, applied: p.plan.applied, credit: p.plan.credit, transition: p.plan.transition?.to ?? null, warnings: plan.warnings };
      if (!values.yes) out({ result: 'plan', plan: summary, next: 're-run with --yes to confirm it' });
      else {
        const r = await confirmProof(proofs.db, pay, id, plan, values.note ?? null);
        out(r.outcome === 'applied' ? { result: 'confirmed', receiptId: r.receiptId, plan: summary } : { result: 'refused', reason: 'this bank reference is already recorded' });
        if (r.outcome !== 'applied') process.exitCode = 1;
      }
    }
  } else if (cmd === 'reject' && id) {
    if (!values.user || values.reason === undefined) throw new Usage();
    const r = await rejectProof(proofs.db, pay, id, values.user, values.reason);
    out(r.ok ? { result: 'rejected', remindersResume: true } : { result: 'refused', reason: r.refusal });
    if (!r.ok) process.exitCode = 1;
  } else throw new Usage();
} catch (e) {
  if (e instanceof Usage) {
    console.error(USAGE);
    process.exitCode = 2;
  } else {
    console.error(e instanceof Error ? e.message : 'failed');
    process.exitCode = 1;
  }
} finally {
  await db.pool.end();
}
