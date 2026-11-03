// The landing copy deck, verbatim from redesign §4.9.4. Claim nothing beyond it (no testimonials, logos, statistics,
// pricing or compliance claims). test/landing-copy.test.ts checks these strings against REDESIGN.md.

export const COPY = {
  h1: "Get paid on time, without the awkward follow-ups.",
  sub: "Dueloop sends polite invoice reminders on a schedule you control, keeps a clear record of every promise and payment, and leaves every important decision to a person.",
  primaryCta: "Create an account",
  secondaryCta: "See how it works",
  trust: "No card details pass through Dueloop. Customers pay you directly.",
  promises: [
    { title: "Remind", body: "Scheduled reminders by email or WhatsApp that respect quiet hours, holidays and consent." },
    { title: "Understand", body: "Replies become promises, disputes or tasks. AI can suggest a meaning; rules decide." },
    { title: "Get paid", body: "Pay links, bank transfer details and proof uploads, all recorded in one ledger." },
  ],
  steps: [
    { title: "Import", body: "Bring in invoices from a CSV or the REST API. You preview every change first, and importing the same file twice changes nothing." },
    { title: "Plan", body: "Your policy decides who is contacted, when, on which channel and with which wording." },
    { title: "Approve", body: "Want to check messages first? Each reminder waits for a person to approve it. One approval covers one message." },
    { title: "Send", body: "Right before sending, Dueloop checks the latest invoice, consent, quiet hours, holidays and your budget. Then it sends once." },
    { title: "Respond", body: "Customers can pay, promise a date, upload proof or ask for a copy from a private page. No account needed." },
    { title: "Confirm", body: "Money counts only when Stripe confirms it, or when an owner or accountant records it with a bank reference." },
    { title: "Close", body: "The ledger updates, the invoice is marked paid and a receipt goes out. The loop is closed." },
  ],
  safetyH2: "Built to be careful with money",
  safety: [
    { title: "\"Already paid\" never closes an invoice.", body: "Only a verified payment or an authorised person can confirm money." },
    { title: "AI suggests, rules decide.", body: "Model output can never change an invoice or send a message by itself." },
    { title: "Never sent twice by accident.", body: "If a send's result is unclear, Dueloop pauses and a person checks." },
  ],
  safetyInline: ["Approvals before sending", "One switch to stop all sending", "Quiet hours and holidays"],
  paymentsH2: "Customers pay you directly.",
  paymentsBody:
    "Dueloop never holds money. Card payments go through your own Stripe account, bank transfers are confirmed by an owner or accountant, and uploaded proof is always checked by a person. Every receipt balances: money received equals amount applied plus credit.",
  channels: ["Email", "WhatsApp (optional, with the customer's consent)", "AI suggestions (optional: with AI off, every reply goes to a person)"],
  roles: [
    { role: "Owner", text: "everything, including the stop-all switch." },
    { role: "Accountant", text: "approvals, payments, imports and policies." },
    { role: "Collector", text: "follows up and works tasks." },
  ],
  faq: [
    { q: "Does Dueloop hold my money?", a: "No. Customers pay you directly; Dueloop records what happened." },
    { q: "Do I have to use AI?", a: "No. With AI off, every customer reply goes to a person as a task, and the rest of Dueloop works the same." },
    { q: "Can I check messages before they go out?", a: "Yes. Require approval and every reminder waits for a person." },
    { q: "How do invoices get in?", a: "Upload a CSV with a preview and error report, or send them through the REST API." },
    { q: "Is my business's data kept separate?", a: "Yes. Each business's data is separated by the database itself." },
    { q: "Is this legal advice for debt collection?", a: "No. Rules differ by country, and Dueloop makes no compliance claim. Check what applies to you." },
  ],
  finalCta: "Start with your next overdue invoice.",
  metaTitle: "Dueloop — polite invoice reminders that get you paid",
} as const;
