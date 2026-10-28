// Customer- and model-supplied text (rule 34, issue G): rendered as a React text node (escaped), never as HTML,
// never as a link. dir="auto" lets Arabic and Urdu read right to left inside an English page.
export function UntrustedText({ text, className, max = 5000 }: { text: string | null | undefined; className?: string; max?: number }) {
  if (!text) return <span className="text-muted-foreground">—</span>;
  const shown = text.length > max ? `${text.slice(0, max)}…` : text;
  return (
    <span dir="auto" className={`whitespace-pre-wrap break-words ${className ?? ""}`}>
      {shown}
    </span>
  );
}

/** Model output: always labelled, always text. */
export function AiText({ text }: { text: string | null | undefined }) {
  return (
    <div className="rounded-md border border-dashed p-2 text-sm" data-ai-untrusted="true">
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">AI-generated, untrusted</p>
      <UntrustedText text={text} />
    </div>
  );
}
