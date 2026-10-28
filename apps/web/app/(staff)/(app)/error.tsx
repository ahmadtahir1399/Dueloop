"use client";

import { Button } from "@/components/ui/button";

// No error details are shown: messages from the server can carry internal text (Next.js replaces server error
// messages in production anyway; the digest is enough to find the log line).
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="grid gap-3 rounded-lg border p-6">
      <p className="font-medium">Something went wrong loading this page.</p>
      {error.digest ? <p className="text-sm text-muted-foreground">Reference: {error.digest}</p> : null}
      <div>
        <Button onClick={reset} variant="outline">
          Try again
        </Button>
      </div>
    </div>
  );
}
