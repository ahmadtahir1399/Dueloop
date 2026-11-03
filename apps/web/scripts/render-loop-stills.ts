// Dev-only (§6.2.6, §10.2 item 9): render one still per beat from the REAL scene at /dev/loop and write
// public/landing/loop-beat-{0..7}.webp (1200) and loop-beat-{0..7}-600.webp, plus og-beat-7.png (1200×630).
// Run against a dev server:  node scripts/render-loop-stills.ts http://localhost:3000
// WebGL in headless Chromium uses the software backend (SwiftShader via ANGLE). Flags from the Chromium docs;
// --enable-unsafe-swiftshader is required by current Chromium for software WebGL (VERIFIED by running this script).
// WebP is encoded by the browser's canvas encoder (sharp is disabled in this repo; AVIF has no canvas encoder,
// so the stills are WebP only: CONFLICTS C-30).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const out = path.resolve(import.meta.dirname, "../public/landing");
mkdirSync(out, { recursive: true });

async function encode(page: Page, png: Buffer, width: number, height: number, type: "image/webp" | "image/png", crop?: { x: number; y: number; w: number; h: number }, fill?: string): Promise<Buffer> {
  const dataUrl = await page.evaluate(
    async ({ b64, width, height, type, crop, fill }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = width;
      c.height = height;
      const ctx = c.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fillRect(0, 0, width, height);
      }
      if (crop) ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, width, height);
      else ctx.drawImage(img, 0, 0, width, height);
      return c.toDataURL(type, 0.86);
    },
    { b64: png.toString("base64"), width, height, type, crop, fill },
  );
  return Buffer.from(dataUrl.split(",")[1] ?? "", "base64");
}

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1200, height: 1200 }, deviceScaleFactor: 1 });
for (let beat = 0; beat < 8; beat++) {
  await page.goto(`${base}/dev/loop?beat=${beat}&still=1&size=1200`, { waitUntil: "networkidle", timeout: 180_000 });
  await page.waitForSelector('#loop-dev[data-ready="1"]', { timeout: 180_000 });
  const png = await page.locator("#loop-dev").screenshot({ type: "png", omitBackground: true });
  writeFileSync(path.join(out, `loop-beat-${beat}.webp`), await encode(page, png, 1200, 1200, "image/webp"));
  writeFileSync(path.join(out, `loop-beat-${beat}-600.webp`), await encode(page, png, 600, 600, "image/webp"));
  if (beat === 7) writeFileSync(path.join(out, "og-beat-7.png"), await encode(page, png, 1200, 630, "image/png", { x: 0, y: 285, w: 1200, h: 630 }, "#F7F8F6"));
  console.log(`beat ${beat}: written`);
}
await browser.close();
