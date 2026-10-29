import { assertSchema } from "@dueloop/ops";
import { trustedPool } from "@/lib/trusted/db";

if (process.env.NODE_ENV === "production") {
  try {
    await assertSchema(trustedPool());
  } catch (e) {
    console.error(e instanceof Error ? e.message : "schema check failed");
    process.exit(1);
  }
}
