// WCAG 2.x contrast (relative luminance, sRGB). Pure. Used by scripts/check-contrast.ts (D1) and its unit test.
// The pair list is §3.1.3 of docs/redesign/REDESIGN.md; `spec` is the ratio the spec printed, `min` what is needed.

export function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m?.[1]) throw new Error(`not a #rrggbb colour: ${hex}`);
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const [r = 0, g = 0, b = 0] = ch;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

export interface Pair {
  name: string;
  fg: string;
  bg: string;
  min: number;
  spec?: number;
}

export const LIGHT: readonly Pair[] = [
  { name: "text on bg", fg: "#1A1F1B", bg: "#F7F8F6", min: 4.5, spec: 15.7 },
  { name: "text on surface", fg: "#1A1F1B", bg: "#FFFFFF", min: 4.5, spec: 16.72 },
  { name: "text on surface-sunken", fg: "#1A1F1B", bg: "#EEF0EC", min: 4.5, spec: 14.58 },
  { name: "text-muted on bg", fg: "#555D54", bg: "#F7F8F6", min: 4.5, spec: 6.4 },
  { name: "text-muted on surface", fg: "#555D54", bg: "#FFFFFF", min: 4.5, spec: 6.82 },
  { name: "text-muted on surface-sunken", fg: "#555D54", bg: "#EEF0EC", min: 4.5, spec: 5.94 },
  { name: "text-subtle on surface (>= 24px, icons)", fg: "#6E776D", bg: "#FFFFFF", min: 3, spec: 4.64 },
  { name: "link on surface", fg: "#1F6E48", bg: "#FFFFFF", min: 4.5, spec: 6.21 },
  { name: "link on bg", fg: "#1F6E48", bg: "#F7F8F6", min: 4.5, spec: 5.83 },
  { name: "on-primary on primary", fg: "#FFFFFF", bg: "#1F6E48", min: 4.5, spec: 6.21 },
  { name: "on-primary on primary-hover", fg: "#FFFFFF", bg: "#1A5A3C", min: 4.5, spec: 8.17 },
  { name: "on-primary on primary-active", fg: "#FFFFFF", bg: "#164831", min: 4.5, spec: 10.47 },
  { name: "primary-soft-text on primary-soft", fg: "#1A5A3C", bg: "#EEF7F1", min: 4.5, spec: 7.47 },
  { name: "border-strong vs surface (input edge)", fg: "#6E776D", bg: "#FFFFFF", min: 3, spec: 4.64 },
  { name: "focus ring vs bg", fg: "#1F6E48", bg: "#F7F8F6", min: 3, spec: 5.83 },
  { name: "focus ring vs surface", fg: "#1F6E48", bg: "#FFFFFF", min: 3, spec: 6.21 },
  { name: "success text on own bg", fg: "#1A5A3C", bg: "#EEF7F1", min: 4.5, spec: 7.47 },
  { name: "warning text on own bg", fg: "#8A5A00", bg: "#FFF4DB", min: 4.5, spec: 5.42 },
  { name: "error text on own bg", fg: "#B42318", bg: "#FEF0EE", min: 4.5, spec: 5.92 },
  { name: "info text on own bg", fg: "#2856A8", bg: "#EDF3FF", min: 4.5, spec: 6.32 },
  { name: "error text on surface", fg: "#B42318", bg: "#FFFFFF", min: 4.5, spec: 6.57 },
  { name: "escalated chip", fg: "#FFFFFF", bg: "#2A302A", min: 4.5, spec: 13.51 },
  { name: "neutral chip", fg: "#3F463F", bg: "#EEF0EC", min: 4.5, spec: 8.48 },
  { name: "inverse text", fg: "#FFFFFF", bg: "#0A2318", min: 4.5, spec: 16.58 },
  { name: "inverse muted on inverse", fg: "#ADDBC0", bg: "#0A2318", min: 4.5, spec: 10.79 },
  { name: "inverse muted on inverse-raised", fg: "#ADDBC0", bg: "#164831", min: 4.5, spec: 6.82 },
  { name: "accent ink on lime", fg: "#0A2318", bg: "#C8F169", min: 4.5, spec: 12.82 },
  // Added by the implementation (not in the spec table): destructive button text.
  { name: "on-destructive on destructive", fg: "#FFFFFF", bg: "#B42318", min: 4.5 },
  { name: "inverse focus ring (lime) vs inverse", fg: "#C8F169", bg: "#0A2318", min: 3 },
];

export const DARK: readonly Pair[] = [
  { name: "text on bg", fg: "#E8EDE9", bg: "#0C110E", min: 4.5, spec: 16.08 },
  { name: "text on surface", fg: "#E8EDE9", bg: "#141A16", min: 4.5, spec: 14.9 },
  { name: "text on raised", fg: "#E8EDE9", bg: "#1B231E", min: 4.5, spec: 13.57 },
  { name: "text-muted on bg", fg: "#9AA59D", bg: "#0C110E", min: 4.5, spec: 7.48 },
  { name: "text-muted on surface", fg: "#9AA59D", bg: "#141A16", min: 4.5, spec: 6.93 },
  { name: "text-muted on raised", fg: "#9AA59D", bg: "#1B231E", min: 4.5, spec: 6.31 },
  { name: "link on surface", fg: "#7DC29C", bg: "#141A16", min: 4.5, spec: 8.47 },
  { name: "on-primary on primary", fg: "#0A2318", bg: "#4DA477", min: 4.5, spec: 5.44 },
  { name: "on-primary on primary-hover", fg: "#0A2318", bg: "#7DC29C", min: 4.5, spec: 7.95 },
  { name: "primary-soft-text on primary-soft", fg: "#ADDBC0", bg: "#123A28", min: 4.5, spec: 8.23 },
  { name: "border-strong vs surface", fg: "#6B776F", bg: "#141A16", min: 3, spec: 3.78 },
  { name: "focus ring (lime) vs bg", fg: "#C8F169", bg: "#0C110E", min: 3, spec: 14.74 },
  { name: "focus ring (lime) vs surface", fg: "#C8F169", bg: "#141A16", min: 3, spec: 13.66 },
  { name: "success text on own bg", fg: "#7DC29C", bg: "#10261A", min: 4.5, spec: 7.66 },
  { name: "warning text on own bg", fg: "#F2C14E", bg: "#2A2110", min: 4.5, spec: 9.46 },
  { name: "error text on own bg", fg: "#FF8A7A", bg: "#2C1412", min: 4.5, spec: 7.54 },
  { name: "info text on own bg", fg: "#8CB4FF", bg: "#131D33", min: 4.5, spec: 8.06 },
  { name: "error text on surface", fg: "#FF8A7A", bg: "#141A16", min: 4.5, spec: 7.71 },
  { name: "escalated chip", fg: "#0E120F", bg: "#E8EDE9", min: 4.5, spec: 15.94 },
  { name: "neutral chip", fg: "#C3C9C1", bg: "#2A302A", min: 4.5, spec: 8.01 },
  { name: "text-secondary on surface", fg: "#C3C9C1", bg: "#141A16", min: 4.5 },
  { name: "on-destructive on destructive", fg: "#2C1412", bg: "#FF8A7A", min: 4.5 },
];

/** Pairs that must never be used as text: they fail (§3.1.3). The check asserts they really are below 4.5. */
export const FORBIDDEN: readonly Pair[] = [
  { name: "white on green-500", fg: "#FFFFFF", bg: "#2D875B", min: 4.5, spec: 4.44 },
  { name: "stone-500 text below 24px on bg", fg: "#6E776D", bg: "#F7F8F6", min: 4.5, spec: 4.36 },
  { name: "lime text on white", fg: "#C8F169", bg: "#FFFFFF", min: 4.5, spec: 1.29 },
];

export interface Result {
  pair: Pair;
  ratio: number;
  ok: boolean;
  specMatches: boolean;
}

export function check(pairs: readonly Pair[], forbidden = false): Result[] {
  return pairs.map((pair) => {
    const ratio = contrast(pair.fg, pair.bg);
    const ok = forbidden ? ratio < pair.min : ratio >= pair.min;
    const specMatches = pair.spec === undefined || Math.abs(Math.round(ratio * 100) / 100 - pair.spec) <= 0.02;
    return { pair, ratio, ok, specMatches };
  });
}
