// D21 (redesign §3.1.4): theme switching works under the production CSP. This suite runs `next start` behind the
// proxy's per-request nonce CSP (playwright.config.ts). Light, Dark and System each change the class on <html> and
// the body background at once; the choice survives a reload with no flash; System follows the OS (emulateMedia).
import { expect, test, type Page } from "@playwright/test";
import { authFile } from "../support/users";

// --color-bg in styles/tokens.css, as computed colours.
const BG = { light: "rgb(247, 248, 246)", dark: "rgb(12, 17, 14)" } as const;
type Resolved = keyof typeof BG;

const bodyBg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

/** Mean luminance (0–255) of a viewport screenshot, decoded in the page (no image library needed). */
async function screenLuma(page: Page): Promise<number> {
  const png = await page.screenshot();
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d");
    if (!ctx) return -1;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 32) {
      sum += 0.2126 * (d[i] ?? 0) + 0.7152 * (d[i + 1] ?? 0) + 0.0722 * (d[i + 2] ?? 0);
      n++;
    }
    return sum / n;
  }, png.toString("base64"));
}

async function choose(page: Page, label: "System" | "Light" | "Dark") {
  await page.getByTestId("theme-menu").click();
  const dialog = page.getByRole("dialog", { name: "Theme" });
  await dialog.locator("label", { hasText: label }).click();
  await expect(dialog.getByRole("radio", { name: label })).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
}

async function expectTheme(page: Page, resolved: Resolved) {
  const other: Resolved = resolved === "dark" ? "light" : "dark";
  await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${resolved}\\b`));
  await expect(page.locator("html")).not.toHaveClass(new RegExp(`\\b${other}\\b`));
  await expect.poll(() => bodyBg(page)).toBe(BG[resolved]);
}

/** Records the theme at DOMContentLoaded, i.e. before hydration: next-themes' nonce'd pre-paint script set it. */
async function recordAtDomContentLoaded(page: Page) {
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      (window as unknown as { __dcl: { cls: string; bg: string } }).__dcl = {
        cls: document.documentElement.className,
        bg: getComputedStyle(document.body).backgroundColor,
      };
    });
  });
}

async function runD21(page: Page, path: string) {
  const cspErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy/.test(m.text()) && /script-src/.test(m.text())) cspErrors.push(m.text());
  });
  await page.emulateMedia({ colorScheme: "light" });
  await recordAtDomContentLoaded(page);
  const res = await page.goto(path);
  // The production CSP is really on: nonce-based scripts, nothing inline without the nonce.
  const scriptSrc = (res?.headers()["content-security-policy"] ?? "").split(";").find((d) => d.trim().startsWith("script-src"));
  expect(scriptSrc?.trim()).toMatch(/^script-src 'self' 'nonce-[^']+' 'strict-dynamic'$/);

  await choose(page, "Light");
  await expectTheme(page, "light");
  await choose(page, "Dark");
  await expectTheme(page, "dark");
  expect(await page.evaluate(() => localStorage.getItem("dl-theme"))).toBe("dark");

  // Kept after reload, with no flash: already dark at DOMContentLoaded, and the first screenshot is dark.
  await page.reload({ waitUntil: "domcontentloaded" });
  expect(await screenLuma(page)).toBeLessThan(90);
  const dcl = await page.evaluate(() => (window as unknown as { __dcl?: { cls: string; bg: string } }).__dcl);
  expect(dcl?.cls).toMatch(/\bdark\b/);
  expect(dcl?.bg).toBe(BG.dark);
  await expectTheme(page, "dark");

  // System follows the OS preference, live.
  await choose(page, "System");
  await expectTheme(page, "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expectTheme(page, "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expectTheme(page, "light");

  expect(cspErrors).toEqual([]);
}

test.describe("D21 theme switching (production CSP)", () => {
  test("landing page", async ({ page }) => {
    await runD21(page, "/");
  });

  test.describe("signed in", () => {
    test.use({ storageState: authFile("owner") });
    test("app shell", async ({ page }) => {
      await runD21(page, "/overview");
    });
    test("the account menu has the same control", async ({ page }) => {
      await page.emulateMedia({ colorScheme: "light" });
      await page.goto("/overview");
      await page.getByLabel("Account and theme").click();
      const menu = page.getByTestId("theme-toggle").first();
      await menu.locator("label", { hasText: "Dark" }).click();
      await expectTheme(page, "dark");
    });
  });

  test("the choice is shared by the landing page and sign-in", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await choose(page, "Dark");
    await page.goto("/sign-in");
    await expectTheme(page, "dark");
  });
});
