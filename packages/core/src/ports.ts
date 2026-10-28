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
  // Prompt 5 (issue A), additive: what OUR payment_requests row records about the provider's object.
  /** The provider's id for the hosted object (e.g. a payment link id); our rows resolve events by it. */
  readonly providerObjectId?: string;
  readonly amountMinor?: number;
  readonly currency?: string;
  /** When the hosted object stops accepting payments, if it does. */
  readonly expiresAt?: Date;
}

/** Fields every prompt 5 event may carry (issue A). Older producers may leave them out. */
interface PaymentEventIds {
  /** The provider's id for this event: the dedupe key (unique per provider). */
  readonly providerEventId?: string;
  /** The provider's id for OUR request's object (resolved against payment_requests, never trusted alone). */
  readonly requestRef?: string;
  /** Live or test mode as the provider states it; must match the account's mode. */
  readonly livemode?: boolean;
}

export type PaymentEvent =
  | ({
      readonly type: 'payment_confirmed';
      readonly providerRef: string;
      readonly amountMinor: number;
      readonly reference?: string;
      readonly paidAt: Date;
      /** ISO 4217 code of amountMinor (prompt 5). */
      readonly currency?: string;
    } & PaymentEventIds)
  | ({ readonly type: 'payment_failed'; readonly providerRef: string; readonly reason?: string } & PaymentEventIds)
  // Prompt 5 additions.
  /** Started but not definitive (e.g. an async method): never paid. */
  | ({ readonly type: 'payment_processing'; readonly providerRef: string } & PaymentEventIds)
  /** Money going back after a confirmation (refund or chargeback/dispute): a task, never a reopened invoice. */
  | ({
      readonly type: 'payment_reversed';
      readonly reversal: 'refund' | 'chargeback';
      readonly providerRef: string;
      readonly amountMinor: number;
      readonly currency?: string;
      readonly at: Date;
    } & PaymentEventIds);

export interface PaymentProvider {
  /** 'bank_transfer' | 'stripe' | 'paypal' | ... */
  readonly name: string;
  createPaymentRequest(args: {
    readonly invoiceId: string;
    readonly amountMinor: number;
    readonly reference: string;
    // Prompt 5, additive.
    readonly currency?: string;
    readonly expiresAt?: Date;
    /** Stable per (invoice, amount): the provider must not create a second object on a retry. */
    readonly idempotencyKey?: string;
  }): Promise<PaymentRequest>;
  /** Must verify the signature on the RAW body before trusting anything inside. */
  handleWebhook(rawBody: string, headers: Readonly<Record<string, string>>): Promise<PaymentEvent[]>;
  /** Prompt 5, optional: polling fallback for requests whose webhook never arrived. */
  getStatus?(providerObjectId: string): Promise<PaymentEvent[]>;
}

export interface InvoiceSource {
  /** 'csv' | 'api' | 'google_sheets' | ... */
  readonly name: string;
  pull(since?: Date): AsyncIterable<{ readonly externalId: string; readonly raw: unknown }>;
}
