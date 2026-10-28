import type { Metadata } from "next";
import { connection } from "next/server";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dueloop",
  description: "Invoice follow-up: who owes what, and what happens next.",
  robots: { index: false, follow: false },
};

// System font stack only (no web fonts, no third-party requests). Every page renders per request so the proxy's
// CSP nonce reaches the framework scripts (Next.js CSP guide, "Forcing dynamic rendering").
export default async function RootLayout({ children }: LayoutProps<"/">) {
  await connection();
  return (
    <html lang="en">
      <body className="min-h-svh bg-background font-sans text-foreground antialiased">
        {children}
        <Toaster richColors />
      </body>
    </html>
  );
}
