"use client";

import { Button } from "@/components/ui/button";

// S30. No error details are shown: messages from the server can carry internal text (Next.js replaces server error
// messages in production anyway; the digest is enough to find the log line).
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="grid max-w-xl gap-4 py-8">
      <h1 className="t-display-lg">Something went wrong</h1>
      <p className="t-body-lg text-ink-muted">Something went wrong loading this page. Nothing was changed.</p>
      {error.digest ? <p className="t-caption text-ink-muted">Reference for support: <code className="tabular-nums">{error.digest}</code></p> : null}
      <div>
        <Button onClick={reset}>Try again</Button>
      </div>
    </div>
  );
}
