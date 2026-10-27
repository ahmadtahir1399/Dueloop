// Ports: the "sockets". The domain only ever talks to these interfaces.
// Interfaces only; adapters implement them outside core.
import type { Channel, Locale } from './domain/types.ts';

export interface OutboundMessage {
  readonly tenantId: string;
  /** Which invoices this message is about (needed to match replies later). */
  readonly invoiceIds: readonly string[];
  readonly to: { readonly email?: string; readonly phoneE164?: string };
  readonly templateKey: string;
  /** Any BCP 47 locale code; not a fixed list of languages. */
  readonly language: Locale;
  /** Customer name, invoice number, amount, pay link ... */
  readonly variables: Readonly<Record<string, string>>;
  readonly idempotencyKey: string;
}

/** Network blip vs. permanent failure (bad number, template not approved). */
export interface SendResult {
  readonly ok: boolean;
  readonly providerMessageId?: string;
  readonly retryable?: boolean;
  readonly error?: string;
}

export interface InboundMessage {
  readonly channel: Channel;
  /** E.164 phone or email address. */
  readonly from: string;
  readonly receivedAt: Date;
  readonly text?: string;
  readonly attachments: readonly { readonly url: string; readonly mime: string }[];
  readonly providerMessageId: string;
  /** Email threading headers or WhatsApp context id, when present. */
  readonly inReplyTo?: string;
}

export interface MessageChannel {
  readonly channel: Channel;
  send(msg: OutboundMessage): Promise<SendResult>;
  /** Verify the provider's signature, then translate its payload into our shape. */
  parseWebhook(rawBody: string, headers: Readonly<Record<string, string>>): Promise<InboundMessage[]>;
}

export interface PaymentRequest {
  readonly kind: 'link' | 'bank_instructions';
  /** Hosted checkout link, when a gateway is used. */
  readonly url?: string;
  /** Account / IBAN / routing details for manual transfer. */
  readonly bankText?: string;
  /** Unique code the customer should quote. */
  readonly reference: string;
}

export type PaymentEvent =
  | {
      readonly type: 'payment_confirmed';
      readonly providerRef: string;
      readonly amountMinor: number;
      readonly reference?: string;
      readonly paidAt: Date;
    }
  | { readonly type: 'payment_failed'; readonly providerRef: string; readonly reason?: string };

export interface PaymentProvider {
  /** 'bank_transfer' | 'stripe' | 'paypal' | ... */
  readonly name: string;
  createPaymentRequest(args: { readonly invoiceId: string; readonly amountMinor: number; readonly reference: string }): Promise<PaymentRequest>;
  /** Must verify the signature on the RAW body before trusting anything inside. */
  handleWebhook(rawBody: string, headers: Readonly<Record<string, string>>): Promise<PaymentEvent[]>;
}

export interface InvoiceSource {
  /** 'csv' | 'api' | 'google_sheets' | ... */
  readonly name: string;
  pull(since?: Date): AsyncIterable<{ readonly externalId: string; readonly raw: unknown }>;
}
