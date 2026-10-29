// Rule 45 at start-up: a production server refuses to serve on a schema mismatch. Next.js calls register() once
// when the server starts (docs: app/api-reference/file-conventions/instrumentation); the Node-only part lives in
// its own module so the Edge build never sees it.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./instrumentation-node");
}
