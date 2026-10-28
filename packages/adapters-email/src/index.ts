// SMTP adapter (nodemailer 10). Plain text only. Every failure is classified into a SendOutcome; the one
// rule that matters (issue K, rule 17): if the server MAY have accepted the message, the outcome is ambiguous.
import nodemailer from 'nodemailer';
import type { EmailContent, OutboundChannel, OutboundEnvelope, SendOutcome } from '@dueloop/messaging';

export interface SmtpSettings {
  readonly host: string;
  readonly port: number;
  /** true = implicit TLS (465). false = plain, upgraded with STARTTLS when the server offers it. */
  readonly secure: boolean;
  readonly user: string | null;
}

export interface SmtpChannelOptions {
  /** Operator default, used when the tenant's channel account names no smtp_host. */
  readonly defaults: SmtpSettings | null;
  /** Kept below the worker's hard timeout, so most hangs are classified here first. */
  readonly timeoutMs: number;
  /**
   * Honour smtp_host/smtp_port from the tenant's channel account. Off by default: a tenant-chosen host makes
   * the worker connect wherever a tenant owner says (SSRF), so only enable it for vetted deployments.
   */
  readonly allowTenantHost?: boolean;
}

/** Codes Node sets only when no connection was ever established: nothing can have been sent. */
const NEVER_CONNECTED = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'EADDRNOTAVAIL']);
/** Failures before MAIL FROM (DNS, authentication, configuration). */
const BEFORE_MAIL = new Set(['EDNS', 'EAUTH', 'ENOAUTH', 'EOAUTH2', 'ECONFIG']);
/** Rejected locally while building the envelope; the same message would fail again. */
const BAD_MESSAGE = new Set(['EENVELOPE', 'EMESSAGE', 'EMAXRECIPIENTS']);

interface MailError {
  readonly code?: unknown;
  readonly originalCode?: unknown;
  readonly command?: unknown;
  readonly responseCode?: unknown;
  readonly permanent?: unknown;
}

/**
 * Note: nodemailer tags EVERY socket error, close and timeout with command 'CONN', whatever phase the session
 * was in, so 'CONN' alone proves nothing. Only a server reply, a never-connected errno, or a pre-MAIL failure
 * proves "not sent". The reason strings are codes, never server text (it can echo addresses: rule 20).
 */
export function classifySmtpError(e: unknown): SendOutcome {
  const err: MailError = typeof e === 'object' && e !== null ? (e as MailError) : {};
  const code = typeof err.code === 'string' ? err.code : 'unknown';
  const rc = typeof err.responseCode === 'number' ? err.responseCode : null;
  if (rc !== null && rc >= 400 && rc < 600) {
    // The server answered with a refusal, so it did not take the message.
    return err.permanent === true ? { kind: 'permanent', reason: `smtp_${rc}` } : { kind: 'not_sent_retryable', reason: `smtp_${rc}` };
  }
  if (BAD_MESSAGE.has(code)) return { kind: 'permanent', reason: `smtp_${code.toLowerCase()}` };
  if (typeof err.originalCode === 'string' && NEVER_CONNECTED.has(err.originalCode)) {
    return { kind: 'not_sent_retryable', reason: `smtp_${err.originalCode.toLowerCase()}` };
  }
  if (BEFORE_MAIL.has(code) || err.command === 'API') return { kind: 'not_sent_retryable', reason: `smtp_${code.toLowerCase()}` };
  return { kind: 'ambiguous', reason: `smtp_${code.toLowerCase()}` };
}

function settingsFor(account: Readonly<Record<string, unknown>>, defaults: SmtpSettings | null, allowTenantHost: boolean): SmtpSettings | null {
  if (allowTenantHost && typeof account.smtp_host === 'string' && account.smtp_host !== '') {
    return {
      host: account.smtp_host,
      port: typeof account.smtp_port === 'number' ? account.smtp_port : 587,
      secure: account.smtp_secure === true,
      user: typeof account.smtp_user === 'string' ? account.smtp_user : null,
    };
  }
  return defaults;
}

export function createSmtpChannel(options: SmtpChannelOptions): OutboundChannel {
  return {
    channel: 'email',
    async send(envelope: OutboundEnvelope, credentials: string | null): Promise<SendOutcome> {
      if (envelope.content.kind !== 'email') return { kind: 'permanent', reason: 'wrong_content_kind' };
      const settings = settingsFor(envelope.account, options.defaults, options.allowTenantHost === true);
      if (!settings) return { kind: 'not_sent_retryable', reason: 'smtp_not_configured' };
      const mail: EmailContent = envelope.content;
      const transport = nodemailer.createTransport({
        host: settings.host,
        port: settings.port,
        secure: settings.secure,
        auth: settings.user ? { user: settings.user, pass: credentials ?? '' } : undefined,
        connectionTimeout: options.timeoutMs,
        greetingTimeout: options.timeoutMs,
        socketTimeout: options.timeoutMs,
        dnsTimeout: options.timeoutMs,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      try {
        const info = await transport.sendMail({
          from: { name: mail.from.name, address: mail.from.address },
          to: { name: mail.to.name, address: mail.to.address },
          subject: mail.subject,
          text: mail.text,
          messageId: mail.messageId,
        });
        if (info.rejected.length > 0 && info.accepted.length === 0) return { kind: 'permanent', reason: 'smtp_rejected' };
        return { kind: 'sent', providerMessageId: info.messageId };
      } catch (e) {
        return classifySmtpError(e);
      } finally {
        transport.close();
      }
    },
  };
}

/** SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_USER from the environment (the password is a Vault secret). */
export function smtpDefaultsFromEnv(env: Readonly<Record<string, string | undefined>>): SmtpSettings | null {
  if (!env.SMTP_HOST) return null;
  return { host: env.SMTP_HOST, port: Number(env.SMTP_PORT ?? 587), secure: env.SMTP_SECURE === 'true', user: env.SMTP_USER ?? null };
}
