import "server-only";
import { assertSchema, heartbeat, SchemaMismatch } from "@dueloop/ops";
import { trustedPool } from "./db";

export async function readiness(): Promise<{ ok: boolean; reason?: string }> {
  try {
    await assertSchema(trustedPool());
    await heartbeat(trustedPool(), "web", true, {}, new Date()).catch(() => undefined);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof SchemaMismatch ? "schema_mismatch" : "database_unreachable" };
  }
}
