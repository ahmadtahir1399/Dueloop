// Bank transfer (issue A/step 5): no gateway, no webhooks. The request is the tenant's own instructions text
// plus the invoice's reference code; money is confirmed only by a human with the right role (rule 27).
import type { PaymentEvent, PaymentProvider, PaymentRequest } from '@dueloop/core';
import { isValidReferenceCode } from '@dueloop/ingest/parsers';

export class BankTransferProvider implements PaymentProvider {
  readonly name = 'bank_transfer';
  private readonly bankText: string;

  constructor(bankText: string) {
    this.bankText = bankText;
  }

  async createPaymentRequest(args: { invoiceId: string; amountMinor: number; reference: string; currency?: string }): Promise<PaymentRequest> {
    // The reference is how a human matches the transfer later; a bad one would make matching a guess.
    if (!isValidReferenceCode(args.reference)) throw new Error('invalid reference code');
    return { kind: 'bank_instructions', bankText: this.bankText, reference: args.reference, amountMinor: args.amountMinor, ...(args.currency ? { currency: args.currency } : {}) };
  }

  async handleWebhook(): Promise<PaymentEvent[]> {
    throw new Error('bank transfers have no webhooks');
  }
}
