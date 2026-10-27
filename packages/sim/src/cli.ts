import { parseArgs } from 'node:util';
import { DateTime } from 'luxon';
import { DEFAULT_START, runSimulation } from './engine.ts';
import { formatText, formatTrace, summarize, traceLines } from './report.ts';

const USAGE = 'Usage: pnpm sim --days N --invoices N --seed N [--start ISO-UTC] [--trace <invoiceId>] [--json]\n';

function positiveInt(name: string, raw: string | undefined, fallback: number, max: number): number | string {
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) return `--${name} must be a non-negative integer`;
  const n = Number(raw);
  return n <= max ? n : `--${name} must be <= ${max}`;
}

function main(argv: readonly string[]): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      options: {
        days: { type: 'string' },
        invoices: { type: 'string' },
        seed: { type: 'string' },
        start: { type: 'string' },
        trace: { type: 'string' },
        json: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
      strict: true,
    });
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n${USAGE}`);
    return 2;
  }
  const v = parsed.values;
  if (v.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  const days = positiveInt('days', v.days, 90, 3650);
  const invoices = positiveInt('invoices', v.invoices, 500, 100_000);
  const seed = positiveInt('seed', v.seed, 42, 0xffffffff);
  const start = v.start ?? DEFAULT_START;
  const errors = [days, invoices, seed].filter((x): x is string => typeof x === 'string');
  if (!DateTime.fromISO(start, { zone: 'UTC' }).isValid) errors.push('--start must be an ISO date-time');
  if (errors.length > 0 || typeof days !== 'number' || typeof invoices !== 'number' || typeof seed !== 'number') {
    process.stderr.write(`${errors.join('\n')}\n${USAGE}`);
    return 2;
  }

  const result = runSimulation({ days, invoices, seed, start });
  const summary = summarize(result);
  if (v.json) {
    const trace = v.trace === undefined ? undefined : (traceLines(result, v.trace) ?? []);
    process.stdout.write(`${JSON.stringify(trace === undefined ? summary : { ...summary, trace: { invoiceId: v.trace, events: trace } }, null, 2)}\n`);
  } else {
    process.stdout.write(formatText(summary));
    if (v.trace !== undefined) process.stdout.write(`\n${formatTrace(result, v.trace)}`);
  }
  // Non-zero exit when any invariant was violated: the sim is a test, not a demo.
  return result.violations.length === 0 ? 0 : 1;
}

process.exitCode = main(process.argv.slice(2));
