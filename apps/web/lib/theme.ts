// Theme preference (§3.1.4): a UI-only cookie, never stored in the database. "system" means: follow the OS.
export const THEME_COOKIE = "dl-theme";
export const THEMES = ["system", "light", "dark"] as const;
export type ThemeChoice = (typeof THEMES)[number];

export function parseTheme(value: string | undefined | null): ThemeChoice {
  return value === "light" || value === "dark" ? value : "system";
}

/** The data-theme attribute for <html>: absent for "system", so the prefers-color-scheme rule applies. */
export function dataTheme(choice: ThemeChoice): "light" | "dark" | undefined {
  return choice === "system" ? undefined : choice;
}
