import Link from "next/link";
import { Button } from "@/components/ui/button";

/** S29 (inside the shell). Same answer for "missing" and "not allowed", so a URL confirms nothing (ADR 0042). */
export default function NotFound() {
  return (
    <div className="grid max-w-xl gap-4 py-8">
      <p className="t-label">Not found</p>
      <h1 className="t-display-lg">We can&apos;t find that page</h1>
      <p className="t-body-lg text-ink-muted">This page does not exist, or you do not have access to it.</p>
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href="/overview">Back to the overview</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/invoices">Invoices</Link>
        </Button>
      </div>
    </div>
  );
}
