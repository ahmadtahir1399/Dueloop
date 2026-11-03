"use client";

// Theme switching (redesign §3.1.4, v1.2): next-themes, the setup shadcn documents for Next.js. It puts class="light"
// or class="dark" on <html> (also when following the OS) and remembers the choice in localStorage under dl-theme.
// Its pre-paint script and its transition-blocking <style> both carry the request's CSP nonce (next-themes 0.4.6
// `nonce` prop, checked in node_modules/next-themes/dist), so the right theme is applied before first paint.
import { ThemeProvider as NextThemesProvider } from "next-themes";

export const THEME_STORAGE_KEY = "dl-theme";

export function ThemeProvider({ nonce, children }: { nonce: string | undefined; children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem storageKey={THEME_STORAGE_KEY} disableTransitionOnChange nonce={nonce}>
      {children}
    </NextThemesProvider>
  );
}
