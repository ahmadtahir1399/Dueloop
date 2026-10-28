// Direct database access for test setup and assertions (local stack only).
import pg from "pg";
import { stack } from "./stack";

let pool: pg.Pool | undefined;
export function db(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: stack().dbUrl, max: 3 });
  return pool;
}
export async function closeDb() {
  await pool?.end();
  pool = undefined;
}
