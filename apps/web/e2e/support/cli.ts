// Runs the real ops CLIs (the "CLI twin" of each UI action) against the local stack. Node is spawned directly
// (no shell), so arguments with spaces arrive intact on every platform.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { stack } from "./stack";

const repoRoot = path.resolve(__dirname, "../../../..");
const BIN: Record<string, string> = {
  approvals: "packages/worker/src/bin/approvals.ts",
  tasks: "packages/worker/src/bin/tasks.ts",
  messages: "packages/worker/src/bin/messages.ts",
  payments: "packages/worker/src/bin/payments.ts",
  proofs: "packages/worker/src/bin/proofs.ts",
  promises: "packages/worker/src/bin/promises.ts",
  tenant: "packages/worker/src/bin/tenant.ts",
  worker: "packages/worker/src/bin/worker.ts",
  import: "packages/ingest/src/cli.ts",
};

export function cli([name, ...args]: string[]): { code: number; out: string } {
  const script = name ? BIN[name] : undefined;
  if (!script) throw new Error(`unknown CLI: ${name}`);
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, WORKER_DATABASE_URL: stack().dbUrl, SUPABASE_URL: stack().apiUrl, SUPABASE_SERVICE_ROLE_KEY: stack().serviceRoleKey },
    timeout: 120_000,
  });
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}
