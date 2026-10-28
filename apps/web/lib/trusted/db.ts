// A trusted Postgres pool for the existing pipelines that run as the database owner (the same connection the
// CLIs use). Callers pass the VERIFIED user id from the session; the database re-checks the role.
import "server-only";
import pg from "pg";
import { trustedDbUrl } from "./env";

const globalForPool = globalThis as unknown as { __dueloopTrustedPool?: pg.Pool };

export function trustedPool(): pg.Pool {
  globalForPool.__dueloopTrustedPool ??= new pg.Pool({ connectionString: trustedDbUrl(), max: 5 });
  return globalForPool.__dueloopTrustedPool;
}
