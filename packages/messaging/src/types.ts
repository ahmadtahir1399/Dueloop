// Contracts shared by the worker and the channel adapters.
//
// Core's MessageChannel.send returns { ok, retryable }, which cannot say "we do not know whether it was
// sent" (issue K). Adapters therefore implement this send-only OutboundChannel with a four-way outcome;
// core is unchanged and MessageChannel.parseWebhook stays for prompt 4 (ADR 0019).
import type { Channel } from '@dueloop/core';

export type SendOutcome =
  /** The provider accepted the message. */
  | { readonly kind: 'sent'; readonly providerMessageId: string | null }
  /** Proven NOT sent (e.g. connection refused, rate-limited, server rejected before accepting); safe to retry. */
  | { readonly kind: 'not_sent_retryable'; readonly reason: string }
  /** Proven not sent and retrying the same message will fail again (bad address, unapproved template). */
  | { readonly kind: 'permanent'; readonly reason: string }
  /** It may or may not have been delivered (timeout, connection lost mid-request). Never resent (rule 17). */
  | { readonly kind: 'ambiguous'; readonly reason: string };

export interface EmailContent {
  readonly kind: 'email';
  readonly to: { readonly address: string; readonly name: string };
  readonly from: { readonly address: string; readonly name: string };
  readonly subject: string;
  /** Plain text only in this phase (no HTML). Footer already appended. */
  readonly text: string;
  /** Our own RFC 5322 Message-ID, "<...@...>", derived from the idempotency key. */
  readonly messageId: string;
}

export interface WhatsAppTemplateContent {
  readonly kind: 'whatsapp_template';
  /** E.164 recipient. */
  readonly to: string;
  readonly templateName: string;
  readonly languageCode: string;
  /** Named body parameters, in template order. */
  readonly parameters: readonly { readonly name: string; readonly text: string }[];
}

export interface OutboundEnvelope {
  readonly tenantId: string;
  readonly idempotencyKey: string;
  /** The tenant's channel_accounts.config for this channel: non-secret settings only (secrets come separately). */
  readonly account: Readonly<Record<string, unknown>>;
  readonly content: EmailContent | WhatsAppTemplateContent;
}

export interface OutboundChannel {
  readonly channel: Channel;
  /** Must never throw: every failure is classified into a SendOutcome. */
  send(envelope: OutboundEnvelope, credentials: string | null): Promise<SendOutcome>;
}

export type AlertSeverity = 'info' | 'warning' | 'critical';

/** Owner/operator alert. Minimal PII: ids, numbers and reason codes, never bodies or contact details. */
export interface Alert {
  readonly tenantId: string;
  /** Same cause + same subject => same key; one alert per period. */
  readonly dedupeKey: string;
  readonly kind: string;
  readonly severity: AlertSeverity;
  readonly title: string;
  readonly lines: readonly string[];
}
