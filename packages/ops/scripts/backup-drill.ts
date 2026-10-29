// pnpm backup:drill: back up the LOCAL stack by the documented CLI procedure, restore into a fresh, empty second
// local stack ("a new project"), and report exactly what came back and what did not. Local only: it refuses any
// non-local database. Output (dumps, report) goes to .demo/backup-drill/ (gitignored; synthetic data only).
//
// Procedure checked against https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
// (three dumps: --role-only; schema; --use-copy --data-only -x storage vector tables; restore with psql
// --single-transaction ON_ERROR_STOP and session_replication_role = replica).
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { assertSchema } from '../src/index.ts';
import { pnpmSpawn } from './pnpm-spawn.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = path.join(root, '.demo', 'backup-drill');
const DRILL_PROJECT = 'dueloop-drill';
const DRILL_DB_CONTAINER = `supabase_db_${DRILL_PROJECT}`;
const DRILL_DB = 'postgresql://postgres:postgres@127.0.0.1:55322/postgres';
const DRILL_API = 'http://127.0.0.1:55321';

const sh = (cmd: string, args: string[], opts: { input?: string; env?: NodeJS.ProcessEnv } = {}) => {
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, env: { ...process.env, MSYS_NO_PATHCONV: '1', ...opts.env }, input: opts.input });
  return { ok: r.status === 0, out: r.stdout ?? '', err: r.stderr ?? '' };
};
const pnpm = (args: string[]) => {
  const r = pnpmSpawn(args, { cwd: root, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  return { ok: r.status === 0, out: String(r.stdout ?? ''), err: String(r.stderr ?? '') };
};
const supabase = (...args: string[]) => pnpm(['exec', 'supabase', ...args]);
const must = (r: { ok: boolean; err: string; out: string }, what: string) => {
  if (!r.ok) throw new Error(`${what} failed: ${(r.err || r.out).trim().split('\n').slice(-3).join(' | ')}`);
  return r.out;
};
const step = (s: string) => console.log(`\n--- ${s}`);

interface Snapshot {
  tables: Record<string, { rows: number; md5: string }>;
  migrations: string[] | null;
  queues: string[];
  cronJobs: number;
  vaultSecrets: number;
  vaultDecryptHash: string | null;
  storageObjectRows: number;
}

/** Row count and an order-independent checksum per table in our schemas (values never leave the database). */
async function snapshot(url: string): Promise<Snapshot> {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  try {
    const q = async <R extends pg.QueryResultRow>(sql: string) => (await pool.query<R>(sql)).rows;
    const tables: Snapshot['tables'] = {};
    for (const t of await q<{ s: string; t: string }>(
      `select table_schema as s, table_name as t from information_schema.tables where table_type = 'BASE TABLE' and table_schema in ('public', 'private') order by 1, 2`,
    )) {
      const r = (await q<{ n: number; h: string | null }>(`select count(*)::int as n, md5(string_agg(md5(x::text), '' order by md5(x::text))) as h from "${t.s}"."${t.t}" x`))[0];
      tables[`${t.s}.${t.t}`] = { rows: r?.n ?? 0, md5: r?.h ?? '-' };
    }
    const has = async (rel: string) => (await q<{ ok: boolean }>(`select to_regclass('${rel}') is not null as ok`))[0]?.ok ?? false;
    const migrations = (await has('supabase_migrations.schema_migrations')) ? (await q<{ v: string }>('select version as v from supabase_migrations.schema_migrations order by 1')).map((r) => r.v) : null;
    const queues = (await q<{ n: string }>(`select queue_name as n from pgmq.list_queues() order by 1`).catch(() => [])).map((r) => r.n);
    const cronJobs = (await q<{ n: number }>('select count(*)::int as n from cron.job').catch(() => [{ n: -1 }]))[0]?.n ?? -1;
    const vaultSecrets = (await q<{ n: number }>('select count(*)::int as n from vault.secrets').catch(() => [{ n: -1 }]))[0]?.n ?? -1;
    const vaultDecryptHash = (await q<{ h: string | null }>(`select md5(string_agg(coalesce(decrypted_secret, '<undecryptable>'), '|' order by id)) as h from vault.decrypted_secrets`).catch(() => [{ h: 'error' }]))[0]?.h ?? null;
    const storageObjectRows = (await q<{ n: number }>('select count(*)::int as n from storage.objects'))[0]?.n ?? 0;
    return { tables, migrations, queues, cronJobs, vaultSecrets, vaultDecryptHash, storageObjectRows };
  } finally {
    await pool.end();
  }
}

function drillConfig(dir: string) {
  // The repo's config with its own project id, every 54xxx port moved to 55xxx, and NO migrations or seed: an
  // empty project, like a freshly created hosted one.
  let s = readFileSync(path.join(root, 'supabase/config.toml'), 'utf8');
  s = s.replace(/project_id = "dueloop"/, `project_id = "${DRILL_PROJECT}"`).replace(/(port\s*=\s*)54(\d{3})/g, '$155$2').replace('inspector_port = 8083', 'inspector_port = 8183');
  s = s.replace(/(\[db\.migrations\][^[]*?enabled\s*=\s*)true/s, '$1false').replace(/(\[db\.seed\][^[]*?enabled\s*=\s*)true/s, '$1false');
  mkdirSync(path.join(dir, 'supabase'), { recursive: true });
  writeFileSync(path.join(dir, 'supabase', 'config.toml'), s);
}

async function main() {
  const status = JSON.parse(must(supabase('status', '-o', 'json'), 'supabase status (is the local stack running? pnpm db:start)').replace(/^[^{]*/, '')) as Record<string, string>;
  const src = status.DB_URL ?? '';
  if (!/@(127\.0\.0\.1|localhost):\d+\//.test(src)) throw new Error('refusing: the source database is not local');
  mkdirSync(OUT, { recursive: true });
  const t0 = performance.now();

  step('1/6 source data: seed + the payments demo (payments, receipts, a proof file in Storage), plus one Vault secret');
  must(supabase('db', 'reset'), 'db reset');
  must(pnpm(['demo:payments']), 'demo:payments');
  const sp = new pg.Pool({ connectionString: src, max: 1 });
  await sp.query(`select vault.create_secret('drill-' || gen_random_uuid(), 'dueloop:backup-drill', 'backup drill probe')`);
  const proof = (await sp.query<{ name: string }>(`select name from storage.objects where bucket_id = 'payment-proofs' order by created_at limit 1`)).rows[0]?.name ?? null;
  await sp.end();
  const before = await snapshot(src);

  step('2/6 backup: the documented three dumps, plus the migration history (our schema guard needs it)');
  for (const [file, args] of [
    ['roles.sql', ['--role-only']],
    ['schema.sql', []],
    ['data.sql', ['--use-copy', '--data-only', '-x', 'storage.buckets_vectors', '-x', 'storage.vector_indexes']],
    ['migrations-schema.sql', ['--schema', 'supabase_migrations']],
    ['migrations-data.sql', ['--use-copy', '--data-only', '--schema', 'supabase_migrations']],
  ] as const)
    must(supabase('db', 'dump', '--local', '-f', path.join(OUT, file), ...args), `db dump ${file}`);

  step('3/6 a fresh, empty second stack (the "new project")');
  const work = mkdtempSync(path.join(tmpdir(), 'dueloop-drill-'));
  drillConfig(work);
  supabase('stop', '--no-backup', '--project-id', DRILL_PROJECT); // leftovers from an interrupted run
  must(supabase('start', '--workdir', work, '-x', 'studio,realtime,imgproxy,edge-runtime,logflare,vector,supavisor,mailpit,postgres-meta'), 'start drill stack');
  const report: Record<string, unknown> = {};
  try {
    const psql = (files: string[], replicaBefore?: string) => {
      for (const f of files) must(sh('docker', ['cp', f, `${DRILL_DB_CONTAINER}:/tmp/${path.basename(f)}`]), `docker cp ${path.basename(f)}`);
      const args = files.flatMap((f) => (path.basename(f) === replicaBefore ? ['--command', 'SET session_replication_role = replica'] : []).concat(['--file', `/tmp/${path.basename(f)}`]));
      const r = sh('docker', ['exec', '-e', 'PGPASSWORD=postgres', DRILL_DB_CONTAINER, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres', '--single-transaction', '--variable', 'ON_ERROR_STOP=1', ...args]);
      return r.ok ? 'ok' : `FAILED: ${r.err.trim().split('\n').slice(-2).join(' | ')}`;
    };
    /** What a running system needs beyond table data: migration history (guard), queues, schedules, ledger. */
    const runtime = async () => {
      const after = await snapshot(DRILL_DB);
      const dp = new pg.Pool({ connectionString: DRILL_DB, max: 1 });
      let guard: string;
      try {
        guard = `ok (${await assertSchema(dp)})`;
      } catch (e) {
        guard = `REFUSED: ${e instanceof Error ? e.message : 'error'}`;
      } finally {
        await dp.end();
      }
      const integrity = sh(process.execPath, ['packages/worker/src/bin/payments.ts', 'integrity'], { env: { WORKER_DATABASE_URL: DRILL_DB } });
      return {
        after,
        summary: {
          migration_history: `${after.migrations?.length ?? 'table missing'} of ${before.migrations?.length ?? 0}`,
          schema_version_guard: guard,
          payments_integrity: integrity.ok ? 'clean' : 'FAILED',
          pgmq_queues_missing: before.queues.filter((x) => !after.queues.includes(x)),
          cron_jobs: `${after.cronJobs} of ${before.cronJobs}`,
        },
      };
    };

    step('4/6 restore with psql exactly as documented (single transaction, stop on error, triggers off for data)');
    report.restore = psql([path.join(OUT, 'roles.sql'), path.join(OUT, 'schema.sql'), path.join(OUT, 'data.sql')], 'data.sql');
    const a = await runtime();
    const tableDiff = Object.entries(before.tables).map(([t, b]) => {
      const x = a.after.tables[t];
      return { table: t, rows_before: b.rows, rows_after: x?.rows ?? null, checksum_equal: x ? x.md5 === b.md5 : false };
    });
    Object.assign(report, {
      tables_total: tableDiff.length,
      tables_identical: tableDiff.filter((d) => d.checksum_equal).length,
      tables_different: tableDiff.filter((d) => !d.checksum_equal),
      after_documented_procedure: a.summary,
    });

    step('5/6 supplementary steps: migration history, then packages/ops/sql/post-restore.sql (queues, schedules, re-queue)');
    report.supplementary_restore = psql([path.join(OUT, 'migrations-schema.sql'), path.join(OUT, 'migrations-data.sql'), path.join(root, 'packages/ops/sql/post-restore.sql')]);
    const b = await runtime();
    let storageFile = 'no proof object in the source';
    if (proof) {
      const res = await fetch(`${DRILL_API}/storage/v1/object/payment-proofs/${proof.split('/').map(encodeURIComponent).join('/')}`, { headers: { Authorization: `Bearer ${status.SERVICE_ROLE_KEY ?? ''}`, apikey: status.SERVICE_ROLE_KEY ?? '' } });
      storageFile = res.ok ? 'downloadable' : `NOT downloadable (HTTP ${res.status}): the row came back, the file did not`;
    }
    Object.assign(report, {
      after_supplementary_steps: b.summary,
      not_restored: {
        vault_secrets: `${b.after.vaultSecrets} of ${before.vaultSecrets} (decrypted values equal: ${before.vaultDecryptHash === b.after.vaultDecryptHash})`,
        storage_files: `${b.after.storageObjectRows} of ${before.storageObjectRows} object rows; proof file ${storageFile}`,
        queued_messages: 'lost with the queues; reminders re-derive from next_action_at, pending inbound/payment events are re-queued by post-restore.sql, unsent receipts and unfetched proofs are not',
      },
    });
  } finally {
    step('6/6 stop and delete the drill stack');
    supabase('stop', '--no-backup', '--project-id', DRILL_PROJECT);
    rmSync(work, { recursive: true, force: true });
  }
  report.seconds = Math.round((performance.now() - t0) / 1000);
  writeFileSync(path.join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nreport: ${path.relative(root, path.join(OUT, 'report.json'))}`);
  // PASS = every table identical, AND after the supplementary steps the schema guard accepts the database, no queue
  // is missing and every schedule is back. Vault secrets and Storage files are reported (not_restored), never hidden:
  // they need the separate steps in docs/runbook.md.
  const sup = report.after_supplementary_steps as { schema_version_guard: string; pgmq_queues_missing: string[]; cron_jobs: string; payments_integrity: string } | undefined;
  const [cronAfter, cronBefore] = (sup?.cron_jobs ?? '0 of 1').split(' of ');
  const ok =
    report.restore === 'ok' &&
    report.supplementary_restore === 'ok' &&
    report.tables_identical === report.tables_total &&
    !!sup?.schema_version_guard.startsWith('ok') &&
    sup.pgmq_queues_missing.length === 0 &&
    cronAfter === cronBefore &&
    sup.payments_integrity === 'clean';
  process.exitCode = ok ? 0 : 1;
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message.replace(/postgres(ql)?:\/\/\S+/g, '[db-url]') : 'failed');
  process.exitCode = 1;
});
