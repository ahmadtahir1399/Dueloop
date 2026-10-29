// Run pnpm from a script started by pnpm, without a shell (no cmd.exe quoting differences on Windows).
// npm_execpath is pnpm's JS entry on some installs and a native executable (pnpm-native.exe) on others (pnpm 12).
import { spawnSync, type SpawnSyncOptions } from 'node:child_process';

export function pnpmSpawn(args: string[], opts: SpawnSyncOptions = {}) {
  const entry = process.env.npm_execpath ?? '';
  if (/\.(c?js|mjs)$/i.test(entry)) return spawnSync(process.execPath, [entry, ...args], opts);
  if (/pnpm[^/\\]*(\.exe)?$/i.test(entry)) return spawnSync(entry, args, opts);
  return spawnSync('pnpm', args, { ...opts, shell: process.platform === 'win32' });
}
