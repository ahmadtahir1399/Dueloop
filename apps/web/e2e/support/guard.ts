// Fails a test if any script runs that should not (issue G): a dialog opening, or the marker the hostile fixtures
// would set. Attach before navigating.
import { expect, type Page } from "@playwright/test";

export function guardAgainstScript(page: Page) {
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  return {
    async check() {
      expect(dialogs, "no dialog may open").toEqual([]);
      expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
      // No element created from fixture markup.
      expect(await page.locator("main script, main img[src='x'], main svg[onload]").count()).toBe(0);
    },
  };
}
