// pnpm tenant pause <id|name> | resume <id|name> | pause --global | resume --global
// The kill switch is checked immediately before every send (rule 18), so it takes effect mid-batch.
import { parseArgs } from 'node:util';
import { openDb, resolveTenant } from '../runtime.ts';

const { positionals, values } = parseArgs({ allowPositionals: true, options: { global: { type: 'boolean', default: false } } });
const [cmd, ref] = positionals;
const db = openDb(process.env);

try {
  if ((cmd === 'pause' || cmd === 'resume') && values.global) {
    await db.pool.query(`update private.system_flags set enabled = $1 where key = 'outbound_paused'`, [cmd === 'pause']);
    console.log(JSON.stringify({ scope: 'global', outbound_paused: cmd === 'pause' }));
  } else if ((cmd === 'pause' || cmd === 'resume') && ref) {
    const tenant = await resolveTenant(db, ref);
    await db.pool.query('select private.set_outbound_paused_impl($1, $2)', [tenant, cmd === 'pause']);
    console.log(JSON.stringify({ tenant, outbound_paused: cmd === 'pause' }));
  } else {
    console.error('usage: pnpm tenant pause|resume <id|name> | pause|resume --global');
    process.exitCode = 2;
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : 'failed');
  process.exitCode = 1;
} finally {
  await db.pool.end();
}
