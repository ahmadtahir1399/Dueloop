// Web fonts (§3.2), self-hosted by next/font at build time: no request to Google from the browser, so the CSP
// (font-src 'self') is unchanged. Verified in node_modules/next/dist/compiled/@next/font/dist/google/font-data.json:
// both families exist and accept weight "variable" (only the wght axis is used). Public link pages (/p, /o) do not
// load these: they keep the system font (low-bandwidth budget).
import { Bricolage_Grotesque, Inter } from "next/font/google";

export const fontBody = Inter({ subsets: ["latin"], variable: "--font-body", display: "swap", weight: "variable" });
export const fontDisplay = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display", display: "swap", weight: "variable" });

export const fontVariables = `${fontBody.variable} ${fontDisplay.variable}`;
