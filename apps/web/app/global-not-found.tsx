import type { Metadata } from "next";
import { connection } from "next/server";

export const metadata: Metadata = { title: "Not found", robots: { index: false, follow: false } };

// Two root layouts (staff and public), so the 404 for unmatched URLs is standalone (Next.js global-not-found).
// Plain markup, no styles from either app: it must never name a business or an invoice.
// Rendered per request (connection()): a prerendered page has no nonce, so CSP blocked every framework script on it
// (Next.js CSP guide, "Forcing dynamic rendering").
export default async function GlobalNotFound() {
  await connection();
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: "2rem" }}>
        <h1>Page not found</h1>
      </body>
    </html>
  );
}
