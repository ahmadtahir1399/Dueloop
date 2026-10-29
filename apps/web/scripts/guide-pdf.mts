// pnpm guide:pdf: renders docs/guides/getting-your-keys.html to a PDF next to it with Playwright's Chromium (the
// browser the e2e suites already install). The PDF is git-ignored: the repo commits no binaries (repo:audit), the
// HTML is the source. Local file only; nothing is fetched (the page has no external resources).
import { chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const source = path.join(root, 'docs/guides/getting-your-keys.html');
const target = path.join(root, 'docs/guides/getting-your-keys.pdf');

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(source).href);
  await page.pdf({
    path: target,
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: '<div style="font:8px Arial;width:100%;text-align:center;color:#556070">Getting your keys · page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
  });
  console.log(`wrote ${path.relative(root, target)}`);
} finally {
  await browser.close();
}
