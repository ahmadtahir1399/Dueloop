import type { Metadata } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";
import { Toaster } from "@/components/ui/sonner";
import { MotionProvider } from "@/components/motion/motion-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { fontVariables } from "@/app/fonts";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "Dueloop",
  description: "Invoice follow-up: who owes what, and what happens next.",
  robots: { index: false, follow: false },
};

// Every page renders per request so the proxy's CSP nonce reaches the framework scripts (Next.js CSP guide,
// "Forcing dynamic rendering"). The theme is next-themes (§3.1.4): its pre-paint script gets the same nonce (the
// proxy passes it as x-nonce), so the stored choice applies before first paint. suppressHydrationWarning is for the
// class that script sets on <html> (next-themes and shadcn docs). Fonts are self-hosted by next/font.
export default async function RootLayout({ children }: LayoutProps<"/">) {
  await connection();
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <body className="min-h-svh bg-canvas font-sans text-ink antialiased">
        <ThemeProvider nonce={nonce}>
          <MotionProvider>{children}</MotionProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
