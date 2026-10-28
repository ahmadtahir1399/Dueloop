// The ONLY place the web app reads server secrets (rule 37). Imported only by modules under lib/trusted, which
// a lint rule keeps out of client code, components and staff pages (eslint.config.js, "trusted-boundary").
// `server-only` makes a client import a build error as a second line of defence.
import "server-only";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`server configuration missing: ${name}`); // the NAME only, never a value
  return v;
}

/** Direct Postgres connection string for trusted pipelines (payments, proofs, links). Never NEXT_PUBLIC_. */
export const trustedDbUrl = () => process.env.SUPABASE_DB_URL ?? required("DATABASE_URL");
/** Service-role key, used only for Storage signed URLs (proof viewing) on the server. */
export const serviceRoleKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? required("SUPABASE_SECRET_KEY");
export const supabaseUrl = () => process.env.SUPABASE_URL ?? required("NEXT_PUBLIC_SUPABASE_URL");
