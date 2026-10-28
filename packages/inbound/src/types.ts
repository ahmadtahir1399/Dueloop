// Normalised inbound shapes (pipeline step 3). Core's InboundMessage port (prompt 1) carries attachment URLs
// and a single inReplyTo; email needs References and DSN details, so the processor uses this richer shape
// and maps onto core only where core needs it (ADR 0024).

export interface AttachmentMeta {
  readonly name: string | null;
  readonly mime: string;
  readonly size: number;
}

/** RFC 3464 delivery report details, when the message is a DSN. */
export interface DeliveryReport {
  readonly action: 'failed' | 'delayed' | 'delivered' | 'relayed' | 'expanded' | null;
  /** RFC 3463 status code, e.g. "5.1.1" (5 = permanent). */
  readonly status: string | null;
  /** The Message-ID of OUR message that bounced, from the returned headers. */
  readonly originalMessageId: string | null;
}

export interface NormalisedMessage {
  readonly kind: 'message';
  readonly channel: 'email' | 'whatsapp';
  /** Email Message-ID ("<...>") or WhatsApp wamid. */
  readonly providerMessageId: string;
  /** Raw sender: an email address or a WhatsApp number (digits, no "+"). */
  readonly from: string;
  readonly toAddresses: readonly string[];
  readonly providerTimestamp: Date | null;
  /** In-Reply-To (email) or context.id (WhatsApp). */
  readonly inReplyTo: string | null;
  readonly references: readonly string[];
  readonly subject: string | null;
  /** All text (HTML converted, never rendered). */
  readonly fullText: string;
  /** The new part of the reply (quoted history stripped; truncated head when stripping found nothing). */
  readonly newText: string;
  readonly attachments: readonly AttachmentMeta[];
  /** Header signals for the pre-filters (RFC 3834 and common autoresponder headers). */
  readonly autoSubmitted: string | null;
  readonly precedence: string | null;
  readonly autoReplyHeader: boolean;
  readonly report: DeliveryReport | null;
}

export type DeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed';

export interface NormalisedStatus {
  readonly kind: 'status';
  readonly channel: 'whatsapp';
  /** The wamid of OUR outbound message. */
  readonly providerMessageId: string;
  readonly status: DeliveryStatus;
  readonly timestamp: Date | null;
  readonly errorCode: number | null;
  readonly bizOpaque: string | null;
}

export type Normalised = NormalisedMessage | NormalisedStatus;

export type NormaliseError = 'too_large' | 'unparseable' | 'unsupported';
