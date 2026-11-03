import { notFound } from "next/navigation";

/** Dev-only pages (§10.2 item 2) answer 404 in production builds. */
export function devOnly(): void {
  if (process.env.NODE_ENV === "production") notFound();
}
