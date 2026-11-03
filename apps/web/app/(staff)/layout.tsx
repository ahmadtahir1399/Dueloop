import type { Metadata } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { Toaster } from "@/components/ui/sonner";
import { MotionProvider } from "@/components/motion/motion-provider";
import { fontVariables } from "@/app/fonts";
import { dataTheme, parseTheme, THEME_COOKIE } from "@/lib/theme";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "Dueloop",
  description: "Invoice follow-up: who owes what, and what happens next.",
  robots: { index: false, follow: false },
};

// Every page renders per request so the proxy's CSP nonce reaches the framework scripts (Next.js CSP guide,
// "Forcing dynamic rendering"). The theme comes from the dl-theme cookie, so the server renders data-theme and
// there is no flash and no inline script. Fonts are self-hosted by next/font.
export default async function RootLayout({ children }: LayoutProps<"/">) {
  await connection();
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="en" data-theme={dataTheme(theme)} className={fontVariables}>
      <body className="min-h-svh bg-canvas font-sans text-ink antialiased">
        <MotionProvider>{children}</MotionProvider>
        <Toaster theme={theme} />
      </body>
    </html>
  );
}
