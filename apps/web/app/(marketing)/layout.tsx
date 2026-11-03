import type { Metadata } from "next";
import { connection } from "next/server";
import { fontVariables } from "@/app/fonts";
import { COPY } from "@/features/landing/copy";
import "@/styles/globals.css";

// The public landing page root (S32). Indexable (the only page that is; route class "marketing" sends no
// X-Robots-Tag). Rendered per request so the proxy's CSP nonce reaches the scripts (CONFLICTS C-02): no database
// work, just HTML. Canonical/OG URLs only when an app URL is configured (Q23).
const site = process.env.PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;

export const metadata: Metadata = {
  title: COPY.metaTitle,
  description: COPY.sub,
  robots: { index: true, follow: true },
  ...(site ? { metadataBase: new URL(site), alternates: { canonical: "/" } } : {}),
  openGraph: {
    title: COPY.metaTitle,
    description: COPY.sub,
    type: "website",
    images: [{ url: "/landing/og-beat-7.png", width: 1200, height: 630, alt: "" }],
  },
};

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  await connection();
  return (
    <html lang="en" className={fontVariables}>
      <body className="min-h-svh bg-canvas font-sans text-ink antialiased">{children}</body>
    </html>
  );
}
