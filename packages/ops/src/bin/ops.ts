// pnpm ops:status            every number the maintainer needs, as JSON (exit 0)
// pnpm ops:watchdog [--now]  evaluates thresholds; prints findings; alerts once per hour per finding through the
//                            prompt 3 notifier (owners of each affected tenant are NOT spammed with system alerts:
//                            system findings go to OPS_ALERT_EMAIL via the SMTP defaults when set); exit 1 on any
//                            critical finding, so a cron entry or uptime monitor can page the operator.
// pnpm ops alive --service <s> [--max-age 300]
//                            container healthcheck: exit 0 when THIS host has a heartbeat for that service younger
//                            than max-age seconds (the worker and processor have no HTTP port).
// pnpm doctor [--service web|worker|webhooks|processor]
//                            config (names only), schema version, connectivity (database, Supabase API, SMTP port).
import { connect } from 'node:net';
import { hostname } from 'node:os';
import { parseArgs } from 'node:util';
import { validateEnv, type Service } from '@dueloop/config';
import pg from 'pg';
import { localEnv } from '../../../db/scripts/local-env.ts';
import { assertSchema, evaluate, EXPECTED_SCHEMA_VERSION, firstAlert, opsStatus } from '../index.ts';

const { positionals, values } = parseArgs({ allowPositionals: true, options: { now: { type: 'string' }, service: { type: 'string', default: 'worker' }, 'max-age': { type: 'string', default: '300' } } });
const [cmd] = positionals;
const dbUrl = process.env.WORKER_DATABASE_URL ?? localEnv().dbUrl;
const pool = new pg.Pool({ connectionString: dbUrl, max: 2, application_name: 'dueloop-ops' });
const now = values.now ? new Date(values.now) : new Date();
const out = (o: unknown) => process.stdout.write(`${JSON.stringify(o, null, 2)}\n`);

async function tcp(host: string, port: number, ms = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const s = connect({ host, port });
    const done = (ok: boolean) => {
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(ms, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

try {
  if (cmd === 'status') {
    out(await opsStatus(pool, now));
  } else if (cmd === 'watchdog') {
    const s = await opsStatus(pool, now);
    const findings = evaluate(s);
    const fresh = [];
    for (const f of findings) if (await firstAlert(pool, f.key, now)) fresh.push(f);
    out({ at: now.toISOString(), findings, alerted: fresh.map((f) => f.key) });
    if (fresh.length && process.env.OPS_ALERT_EMAIL && process.env.SMTP_HOST) {
      const nodemailer = await import('nodemailer');
      const t = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT ?? 587), secure: process.env.SMTP_SECURE === 'true' });
      await t.sendMail({ from: process.env.OPS_ALERT_FROM ?? 'dueloop-watchdog@localhost', to: process.env.OPS_ALERT_EMAIL, subject: `[dueloop] ${fresh.length} ops finding(s)`, text: fresh.map((f) => `${f.severity}: ${f.message}`).join('\n') });
    }
    if (findings.some((f) => f.severity === 'critical')) process.exitCode = 1;
  } else if (cmd === 'alive') {
    const r = await pool.query<{ ok: boolean }>(
      `select exists (select 1 from private.service_heartbeats where service = $1 and instance_id like $2 and last_seen_at > $3::timestamptz - make_interval(secs => $4::int)) as ok`,
      [values.service, `${hostname().slice(0, 60)}:%`, now, Number(values['max-age'])],
    );
    process.exitCode = r.rows[0]?.ok ? 0 : 1;
  } else if (cmd === 'doctor') {
    const service = values.service as Service;
    const checks: { check: string; ok: boolean; detail: string }[] = [];
    const problems = validateEnv(service, process.env);
    checks.push({ check: `config (${service})`, ok: problems.length === 0, detail: problems.join('; ') || 'ok' });
    try {
      await pool.query('select 1');
      checks.push({ check: 'database reachable', ok: true, detail: 'ok' });
      try {
        checks.push({ check: 'schema version', ok: true, detail: await assertSchema(pool) });
      } catch (e) {
        checks.push({ check: 'schema version', ok: false, detail: e instanceof Error ? e.message : 'failed' });
      }
    } catch {
      checks.push({ check: 'database reachable', ok: false, detail: 'cannot connect (check WORKER_DATABASE_URL / the local stack)' });
    }
    const api = process.env.SUPABASE_URL ?? (process.env.WORKER_DATABASE_URL ? null : localEnv().apiUrl);
    if (api) {
      const r = await fetch(`${api}/auth/v1/health`).then((x) => x.status, () => 0);
      checks.push({ check: 'Supabase API reachable', ok: r > 0 && r < 500, detail: r ? `HTTP ${r}` : 'unreachable' });
    }
    if (process.env.SMTP_HOST) {
      const ok = await tcp(process.env.SMTP_HOST, Number(process.env.SMTP_PORT ?? 587));
      checks.push({ check: 'SMTP port open', ok, detail: ok ? 'ok' : 'cannot connect' });
    }
    console.table(checks);
    console.log(`expected schema ${EXPECTED_SCHEMA_VERSION}`);
    if (checks.some((c) => !c.ok)) process.exitCode = 1;
  } else {
    console.error('usage: ops status | watchdog [--now <iso>] | doctor [--service web|worker|webhooks|processor]');
    process.exitCode = 2;
  }
} catch (e) {
  console.error(e instanceof Error ? e.message.replace(/postgres(ql)?:\/\/\S+/g, '[db-url]') : 'failed');
  process.exitCode = 1;
} finally {
  await pool.end();
}
