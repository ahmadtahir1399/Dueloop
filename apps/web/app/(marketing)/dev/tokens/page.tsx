import { readFileSync } from "node:fs";
import path from "node:path";
import { devOnly } from "@/lib/dev-only";

export const metadata = { robots: { index: false, follow: false } };

/** /dev/tokens: every colour token in light and dark side by side (dev only, §9 Phase 1). */
export default function DevTokensPage() {
  devOnly();
  const css = readFileSync(path.join(process.cwd(), "styles/tokens.css"), "utf8");
  const root = css.slice(css.indexOf(":root {"), css.indexOf("@media (min-width"));
  const names = [...new Set([...root.matchAll(/(--color-[a-z0-9-]+):/g)].map((m) => m[1] ?? ""))].filter(Boolean);
  const type = ["t-display-2xl", "t-display-xl", "t-display-lg", "t-display-md", "t-heading-lg", "t-heading-md", "t-heading-sm", "t-body-lg", "t-body-md", "t-body-sm", "t-caption", "t-label"];
  return (
    <main className="grid gap-10 p-8">
      <h1 className="t-display-lg">Tokens</h1>
      <div className="grid gap-8 lg:grid-cols-2">
        {(["light", "dark"] as const).map((theme) => (
          <section key={theme} className={`${theme} grid gap-2 rounded-xl bg-canvas p-6 text-ink`}>
            <h2 className="t-heading-lg">{theme}</h2>
            <ul className="grid grid-cols-2 gap-2 t-caption sm:grid-cols-3">
              {names.map((n) => (
                <li key={n} className="flex items-center gap-2">
                  <span className="size-6 shrink-0 rounded-sm border border-line" style={{ background: `var(${n})` }} />
                  <code>{n.replace("--color-", "")}</code>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <section className="grid gap-3">
        <h2 className="t-heading-lg">Type scale</h2>
        {type.map((t) => (
          <p key={t} className={t}>
            {t} · 4,825.00 USD promised for the 15th
          </p>
        ))}
      </section>
    </main>
  );
}
