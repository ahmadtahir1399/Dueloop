// The landing page and its real-time 3D (redesign D15–D18). Chromium uses software WebGL (SwiftShader via ANGLE;
// see the "landing" project in playwright.config.ts). E2E_LANDING_BASE_URL lets the same spec run against a dev server.
import { expect, test, type Page } from "@playwright/test";

const base = process.env.E2E_LANDING_BASE_URL;
if (base) test.use({ baseURL: base });

async function stagePixels(page: Page): Promise<{ std: number; buf: Buffer }> {
  const buf = await page.locator(".stage").screenshot();
  const std = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d");
    if (!ctx) return 0;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    let sq = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 16) {
      const v = ((d[i] ?? 0) + (d[i + 1] ?? 0) + (d[i + 2] ?? 0)) / 3;
      sum += v;
      sq += v * v;
      n++;
    }
    const mean = sum / n;
    return Math.sqrt(sq / n - mean * mean);
  }, buf.toString("base64"));
  return { std, buf };
}

async function scrollToBeat(page: Page, beat: number) {
  await page.locator(`[data-story-block="${beat}"]`).evaluate((el) => {
    const r = el.getBoundingClientRect();
    window.scrollTo({ top: window.scrollY + r.top - window.innerHeight * 0.45 + r.height * 0.3, behavior: "instant" });
  });
  await expect(page.locator("[data-story]")).toHaveAttribute("data-beat", String(beat));
}

test.describe("desktop (Tier 2)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("D15: the 3D really renders, and beats 0, 3 and 7 differ", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".stage")).toHaveAttribute("data-3d-state", "running", { timeout: 30_000 });
    await expect(page.locator(".stage canvas")).toBeVisible();
    await page.waitForTimeout(1500); // let the canvas fade in over the still
    const shots: Buffer[] = [];
    for (const b of [0, 3, 7]) {
      await scrollToBeat(page, b);
      await page.waitForTimeout(1200);
      const { std, buf } = await stagePixels(page);
      expect(std, `beat ${b} is not blank`).toBeGreaterThan(8);
      shots.push(buf);
    }
    const [s0, s3, s7] = shots;
    expect(s0 && s3 && s0.equals(s3)).toBe(false);
    expect(s3 && s7 && s3.equals(s7)).toBe(false);
  });

  test("D16: the story stays in sync both ways", async ({ page }) => {
    await page.goto("/");
    for (let b = 0; b <= 7; b++) {
      await scrollToBeat(page, b);
      if (b > 0) await expect(page.locator(`[data-story-block="${b}"]`)).toHaveAttribute("aria-current", "step");
    }
    for (let b = 7; b >= 0; b--) await scrollToBeat(page, b);
  });

  test("D17: pause stops the motion and is remembered", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".stage")).toHaveAttribute("data-3d-state", "running", { timeout: 30_000 });
    await page.getByRole("button", { name: "Pause animation" }).click();
    await expect(page.locator(".stage")).toHaveAttribute("data-3d-state", "paused");
    await page.waitForTimeout(500);
    const a = await page.locator(".stage").screenshot();
    await page.waitForTimeout(1000);
    const b = await page.locator(".stage").screenshot();
    expect(a.equals(b)).toBe(true);
    await page.reload();
    await expect(page.locator(".stage")).toHaveAttribute("data-3d-state", "static", { timeout: 30_000 });
  });
});

test.describe("fallbacks (D18)", () => {
  test("reduced motion: Tier 0 stills, no canvas, the whole story as text", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.locator(".stage")).toHaveAttribute("data-tier", "0", { timeout: 30_000 });
    await expect(page.locator(".stage canvas")).toHaveCount(0);
    await expect(page.locator("[data-story-block]")).toHaveCount(8);
  });

  test("390 px: Tier 1 at most", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.locator(".stage")).not.toHaveAttribute("data-tier", "pending", { timeout: 30_000 });
    const tier = Number(await page.locator(".stage").getAttribute("data-tier"));
    expect(tier).toBeLessThanOrEqual(1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("no WebGL: stills, story complete", async ({ page }) => {
    await page.addInitScript(() => {
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (type === "webgl2" || type === "webgl") return null;
        return (orig as (...a: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof orig;
    });
    await page.goto("/");
    await expect(page.locator(".stage")).toHaveAttribute("data-tier", "0", { timeout: 30_000 });
    await expect(page.locator(".stage canvas")).toHaveCount(0);
  });
});

test("the landing page claims only the copy deck and has exactly one h1", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Get paid on time, without the awkward follow-ups.");
  await expect(page.getByRole("link", { name: "Create an account" }).first()).toHaveAttribute("href", "/sign-up");
  await expect(page.locator("form")).toHaveCount(0);
});
