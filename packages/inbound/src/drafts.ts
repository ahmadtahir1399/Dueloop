// DRAFT replies for human tasks. Code-written from fixed wording plus our own data (never the model's
// summary, never the customer's text). A human reviews, edits and sends them; nothing here is ever sent.

export function ambiguousInvoiceDraft(businessName: string, candidates: readonly { number: string }[]): string {
  const list = candidates.map((c) => `- ${c.number}`).join('\n');
  return `Hello,\n\nThank you for your message. Could you let us know which invoice you mean?\n\n${list}\n\nThank you,\n${businessName}`;
}

export function infoRequestDraft(businessName: string, invoiceNumber: string, referenceCode: string): string {
  return (
    `Hello,\n\nThank you for your reply about invoice ${invoiceNumber}. [Add the information requested here.]\n\n` +
    `When paying by bank transfer, please quote ${referenceCode}.\n\nThank you,\n${businessName}`
  );
}
