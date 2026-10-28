// pnpm payments record --tenant <t> --invoice <number|id> --amount <text> --date <YYYY-MM-DD> --bank-ref <ref>
//                       --user <email|id> [--note "..."] [--decimal ,] [--yes]
//               integrity [--tenant <t>]          exit 1 on any finding (also: pnpm payments:integrity)
//               process --once | --loop [--tenant <t>] [--now <iso>]   drain payment events, sweep, poll
// Never prints payer data, bank numbers or payloads: ids, amounts in minor units and codes only.
import { planManualPayment, pollPending, processPaymentBatch, recordManualPayment, sweepRequests } from '@dueloop/payments';
import { parseArgs } from 'node:util';
import { buildPaymentsDeps, clockFrom, openDb, resolveTenant } from '../runtime.ts';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    tenant: { type: 'string' },
    invoice: { type: 'string' },
    amount: { type: 'string' },
    date: { type: 'string' },
    'bank-ref': { type: 'string' },
    user: { type: 'string' },
    note: { type: 'string' },
    decimal: { type: 'string', default: '.' },
    yes: { type: 'boolean', default: false },
    once: { type: 'boolean', default: false },
    loop: { type: 'boolean', default: false },
    now: { type: 'string' },
  },
});
class Usage extends Error {}
const [cmd] = positionals;
const db = openDb(process.env);
const clock = clockFrom(values.now);
const deps = buildPaymentsDeps(process.env, db, clock);
const out = (o: unknown) => process.stdout.write(`${JSON.stringify(o)}\n`);
const USAGE = 'usage: pnpm payments record --tenant --invoice --amount --date --bank-ref --user [--note] [--yes] | integrity [--tenant] | process --once|--loop [--tenant]';

let stopping = false;
process.on('SIGINT', () => (stopping = true));
process.on('SIGTERM', () => (stopping = true));

try {
  if (cmd === 'record') {
    if (!values.tenant || !values.invoice || !values.amount || !values.date || values['bank-ref'] === undefined || !values.user) throw new Usage();
    if (values.decimal !== '.' && values.decimal !== ',') throw new Usage();
    const tenantId = await resolveTenant(db, values.tenant);
    const p = await planManualPayment(deps, {
      tenantId,
      invoice: values.invoice,
      amount: values.amount,
      date: values.date,
      bankRef: values['bank-ref'],
      user: values.user,
      decimal: values.decimal,
      ...(values.note ? { note: values.note } : {}),
    });
    if (!p.ok) {
      out({ result: 'refused', reason: p.refusal });
      process.exitCode = 1;
    } else {
      const plan = { invoice: p.invoice.number, currency: p.invoice.currency, balance: p.invoice.balanceMinor, amount: p.amountMinor, applied: p.plan.applied, credit: p.plan.credit, transition: p.plan.transition?.to ?? null, promise: p.plan.promiseOutcome, events: p.plan.events, tasks: p.plan.tasks.map((t) => t.type), receipt: p.plan.sendReceipt };
      if (!values.yes) out({ result: 'plan', plan, next: 're-run with --yes to record it' });
      else {
        const r = await recordManualPayment(deps, p, values.note ?? null);
        if (r.outcome === 'duplicate') {
          out({ result: 'refused', reason: 'this bank reference is already recorded' });
          process.exitCode = 1;
        } else out({ result: 'recorded', receiptId: r.receiptId, plan });
      }
    }
  } else if (cmd === 'integrity') {
    const tenantId = values.tenant ? await resolveTenant(db, values.tenant) : null;
    const findings = await deps.db.integrity(tenantId);
    for (const f of findings) out({ finding: f.finding, tenantId: f.tenantId, ref: f.ref, detail: f.detail });
    out({ result: findings.length === 0 ? 'clean' : 'findings', count: findings.length });
    if (findings.length > 0) process.exitCode = 1;
  } else if (cmd === 'process' && values.once !== values.loop) {
    const filter: Record<string, string> = values.tenant ? { tenant_id: await resolveTenant(db, values.tenant) } : {};
    const pass = async () => {
      const totals: Record<string, number> = {};
      for (;;) {
        const r = await processPaymentBatch(deps, { limit: 20, filter });
        for (const [k, n] of Object.entries(r.outcomes)) totals[k] = (totals[k] ?? 0) + n;
        if (r.claimed === 0 || stopping) break;
      }
      const sweep = await sweepRequests(deps);
      const poll = await pollPending(deps);
      out({ level: 'info', event: 'payments_pass_done', at: clock.now().toISOString(), totals, sweep, poll });
    };
    if (values.once) await pass();
    else
      while (!stopping) {
        await pass();
        for (let w = 0; w < 5000 && !stopping; w += 250) await new Promise((r) => setTimeout(r, 250));
      }
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

