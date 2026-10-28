// DRIFT TESTS: the database must say exactly what packages/core and packages/db say.
import { CHANNELS, INVOICE_STATUSES, PLAN_TASK_TYPES, TRANSITIONS, isIanaZone } from '@dueloop/core';
import { describe, expect, it } from 'vitest';
import { INVOICE_EVENT_TYPES, TENANT_EVENT_TYPES } from '../src/events.ts';
import { query, withClient } from './db.ts';

/** Quoted string literals inside the CHECK constraint that constrains exactly `table.column`. */
async function checkValues(table: string, column: string): Promise<string[]> {
  const rows = await query<{ def: string }>(
    `select pg_get_constraintdef(c.oid) as def from pg_constraint c
     where c.conrelid = $1::regclass and c.contype = 'c'
       and c.conkey = array[(select a.attnum from pg_attribute a where a.attrelid = $1::regclass and a.attname = $2)]`,
    [table, column],
  );
  expect(rows, `${table}.${column} has exactly one CHECK`).toHaveLength(1);
  return [...(rows[0]?.def ?? '').matchAll(/'([^']+)'::text/g)].map((m) => m[1] ?? '').sort();
}

describe('core <-> database drift', () => {
  it('private.invoice_status_transitions equals core TRANSITIONS (as event/from/to triples and from/to pairs)', async () => {
    const core = TRANSITIONS.flatMap((t) => t.from.map((f) => `${t.event}:${f}->${t.to}`)).sort();
    const db = (
      await query<{ k: string }>(`select event || ':' || from_status || '->' || to_status as k from private.invoice_status_transitions`)
    )
      .map((r) => r.k)
      .sort();
    expect(db).toEqual(core);
    const pairs = (xs: string[]) => [...new Set(xs.map((x) => x.split(':')[1]))].sort();
    expect(pairs(db)).toEqual(pairs(core));
  });

  it('invoices.status CHECK equals core INVOICE_STATUSES', async () => {
    expect(await checkValues('public.invoices', 'status')).toEqual([...INVOICE_STATUSES].sort());
  });

  it.each([
    ['public.customers', 'preferred_channel'],
    ['public.messages', 'channel'],
  ])('%s.%s CHECK equals core CHANNELS', async (table, column) => {
    expect(await checkValues(table, column)).toEqual([...CHANNELS].sort());
  });

  it('invoice_events.type CHECK equals the packages/db event type union', async () => {
    expect(await checkValues('public.invoice_events', 'type')).toEqual([...INVOICE_EVENT_TYPES].sort());
  });

  it('tenant_events.type CHECK equals the packages/db tenant event type union', async () => {
    expect(await checkValues('public.tenant_events', 'type')).toEqual([...TENANT_EVENT_TYPES].sort());
  });

  it('tasks.type CHECK contains every task type core planReplyOutcome can create', async () => {
    const db = await checkValues('public.tasks', 'type');
    for (const t of PLAN_TASK_TYPES) expect(db).toContain(t);
  });

  it('the timezone trigger accepts exactly the Postgres zone names that core isIanaZone() accepts', async () => {
    const names = (await query<{ name: string }>('select name from pg_timezone_names order by name')).map((r) => r.name);
    expect(names.length).toBeGreaterThan(400);
    const accepted = await withClient(async (c) => {
      const out: string[] = [];
      await c.query('begin');
      await c.query(`insert into public.tenants (id, name, timezone, currency) values
                     ('00000000-0000-0000-0000-0000000000ee', 'tz probe', 'UTC', 'USD')`);
      for (const name of names) {
        await c.query('savepoint s');
        try {
          await c.query(`update public.tenants set timezone = $1 where id = '00000000-0000-0000-0000-0000000000ee'`, [name]);
          out.push(name);
        } catch {
          // rejected by the trigger
        }
        await c.query('rollback to savepoint s');
      }
      await c.query('rollback');
      return out;
    });
    expect(accepted).toEqual(names.filter((n) => isIanaZone(n)));
  });
});
