// pnpm pilot:snapshot --tenant <id> --kind baseline|periodic --from <YYYY-MM-DD> --to <YYYY-MM-DD>
//                     [--client key=value ...] [--notes "..."] [--user <who>] [--now <iso>]
//   Freezes the KPI functions for one tenant and one inclusive LOCAL-date period (migration 0023). One baseline per
//   tenant. --client adds numbers only the client knows (e.g. staff_hours_per_week=6), stored and shown as
//   client-reported. Trusted connection only.
// pnpm pilot:report --tenant <id> [--from <YYYY-MM-DD> --to <YYYY-MM-DD>] [--csv <file>]
//   The baseline versus the latest periodic snapshot (within the period when given), with the limits of the
//   comparison. The CSV neutralises spreadsheet formulas (rule 14).
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { localEnv } from '../../../db/scripts/local-env.ts';
import { pilotReport, reportCsv, REPORT_LIMITS, type KpiSnapshot } from '../pilot.ts';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    tenant: { type: 'string' },
    kind: { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
    client: { type: 'string', multiple: true },
    notes: { type: 'string' },
    user: { type: 'string', default: 'cli' },
    now: { type: 'string' },
    csv: { type: 'string' },
  },
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const [cmd] = positionals;
const pool = new pg.Pool({ connectionString: process.env.WORKER_DATABASE_URL ?? localEnv().dbUrl, max: 1, application_name: 'dueloop-pilot' });

try {
  if (!UUID.test(values.tenant ?? '')) throw new Error('--tenant must be a tenant id');
  if (cmd === 'snapshot') {
    if (values.kind !== 'baseline' && values.kind !== 'periodic') throw new Error('--kind must be baseline or periodic');
    if (!DATE.test(values.from ?? '') || !DATE.test(values.to ?? '')) throw new Error('--from and --to are local dates YYYY-MM-DD');
    const client: Record<string, number | string> = {};
    for (const kv of values.client ?? []) {
      const [k, v] = kv.split('=');
      if (!k || v === undefined || !/^[a-z][a-z0-9_]{0,40}$/.test(k)) throw new Error('--client takes key=value with a lowercase key');
      client[k] = /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v.slice(0, 200);
    }
    const now = values.now ? new Date(values.now) : new Date();
    const r = await pool.query<{ id: string }>('select private.kpi_snapshot($1, $2, $3, $4, $5, $6, $7, $8) as id', [values.tenant, values.kind, values.from, values.to, now, values.user, values.notes ?? null, JSON.stringify(client)]);
    process.stdout.write(`${JSON.stringify({ result: 'snapshot_taken', id: r.rows[0]?.id, kind: values.kind, period: [values.from, values.to] })}\n`);
  } else if (cmd === 'report') {
    const snaps = (await pool.query<KpiSnapshot>(`select kind, taken_at::text, period_from::text, period_to::text, kpis, client_reported from public.kpi_snapshots where tenant_id = $1 order by taken_at`, [values.tenant])).rows;
    const base = snaps.find((s) => s.kind === 'baseline');
    if (!base) throw new Error('no baseline for this tenant: pnpm pilot:snapshot --kind baseline first');
    const inPeriod = snaps.filter((s) => s.kind === 'periodic' && (!values.from || s.period_from >= values.from) && (!values.to || s.period_to <= values.to));
    const now = inPeriod.at(-1);
    if (!now) throw new Error('no periodic snapshot in that period: pnpm pilot:snapshot --kind periodic');
    const rows = pilotReport(base, now);
    console.log(`Baseline ${base.period_from}..${base.period_to} (taken ${base.taken_at}) versus ${now.period_from}..${now.period_to} (taken ${now.taken_at}); tenant-local dates.`);
    console.table(rows);
    console.log(`Limits:\n${REPORT_LIMITS.map((l) => `  - ${l}`).join('\n')}`);
    if (values.csv) {
      writeFileSync(values.csv, reportCsv(rows));
      console.log(`CSV: ${values.csv}`);
    }
  } else {
    console.error('usage: pilot.ts snapshot --tenant <id> --kind baseline|periodic --from <date> --to <date> [--client k=v] | report --tenant <id> [--from --to] [--csv file]');
    process.exitCode = 2;
  }
} catch (e) {
  console.error(e instanceof Error ? e.message.replace(/postgres(ql)?:\/\/\S+/g, '[db-url]') : 'failed');
  process.exitCode = 1;
} finally {
  await pool.end();
}
