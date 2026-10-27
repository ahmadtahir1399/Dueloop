// Connection details for the LOCAL Supabase stack. Environment variables win; otherwise they are read
// from `supabase status -o json` at runtime. Nothing here is ever written to disk or logged.
import { execSync } from 'node:child_process';

export interface LocalEnv {
  readonly dbUrl: string;
  readonly apiUrl: string;
  readonly anonKey: string;
  readonly serviceRoleKey: string;
}

let cached: LocalEnv | undefined;

export function localEnv(): LocalEnv {
  if (cached) return cached;
  const env = process.env;
  let status: Record<string, string> = {};
  if (!env.SUPABASE_DB_URL || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.SUPABASE_SERVICE_ROLE_KEY) {
    // Right after `supabase db reset` the containers restart and status fails for a few seconds.
    for (let attempt = 1; ; attempt++) {
      try {
        const out = execSync('supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        status = JSON.parse(out) as Record<string, string>;
        break;
      } catch (e) {
        if (attempt >= 10) throw e;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000);
      }
    }
  }
  const pick = (envName: string, statusName: string): string => {
    const v = env[envName] ?? status[statusName];
    if (!v) throw new Error(`missing ${envName} (and ${statusName} in supabase status)`);
    return v;
  };
  cached = {
    dbUrl: pick('SUPABASE_DB_URL', 'DB_URL'),
    apiUrl: pick('SUPABASE_URL', 'API_URL'),
    anonKey: pick('SUPABASE_ANON_KEY', 'ANON_KEY'),
    serviceRoleKey: pick('SUPABASE_SERVICE_ROLE_KEY', 'SERVICE_ROLE_KEY'),
  };
  return cached;
}
