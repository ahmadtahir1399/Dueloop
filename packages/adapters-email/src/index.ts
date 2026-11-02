// SMTP adapter (nodemailer 10). Plain text only. Every failure is classified into a SendOutcome; the one
// rule that matters (issue K, rule 17): if the server MAY have accepted the message, the outcome is ambiguous.
import nodemailer from 'nodemailer';
import type { EmailContent, OutboundChannel, OutboundEnvelope, SendOutcome } from '@dueloop/messaging';
import { pinnedAddress } from './net-guard.ts';
import { createResendChannel } from './resend.ts';
import { fromDomainsFromEnv, senderAllowed } from './sender.ts';

export interface SmtpSettings {
  readonly host: string;
  readonly port: number;
  /** true = implicit TLS (465). false = plain, upgraded with STARTTLS when the server offers it. */
  readonly secure: boolean;
  readonly user: string | null;
  /** Operator default only (SMTP_PASSWORD). Never set on, or sent to, a tenant-chosen host. */
  readonly password?: string | null;
  /** Operator default only (SMTP_FROM_DOMAINS): sender domains this relay may send for. Empty = no limit. */
  readonly allowedFromDomains?: readonly string[];
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
  /**
   * Is a resolved address acceptable for a business-chosen host? Default: public addresses only (no loopback,
   * private, link-local, CGNAT or multicast): the worker would otherwise connect to internal services (SSRF).
   * Injected only by the protocol tests, whose scripted server listens on 127.0.0.1.
   */
  readonly tenantAddressAllowed?: (ip: string) => boolean;
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

function settingsFor(account: Readonly<Record<string, unknown>>, defaults: SmtpSettings | null, allowTenantHost: boolean): { s: SmtpSettings; tenantHost: boolean } | null {
  if (allowTenantHost && typeof account.smtp_host === 'string' && account.smtp_host !== '') {
    return {
      s: { host: account.smtp_host, port: typeof account.smtp_port === 'number' ? account.smtp_port : 587, secure: account.smtp_secure === true, user: typeof account.smtp_user === 'string' ? account.smtp_user : null },
      tenantHost: true,
    };
  }
  return defaults ? { s: defaults, tenantHost: false } : null;
}

/**
 * Where to connect and how to log in. The tenant's own saved password wins; the operator's SMTP_PASSWORD is used
 * only for the operator's default host, never for a host a tenant chose.
 */
export function smtpLogin(
  account: Readonly<Record<string, unknown>>,
  defaults: SmtpSettings | null,
  allowTenantHost: boolean,
  tenantPassword: string | null,
): { host: string; port: number; secure: boolean; auth: { user: string; pass: string } | undefined; requireTLS: boolean; tenantHost: boolean } | null {
  const r = settingsFor(account, defaults, allowTenantHost);
  if (!r) return null;
  const operatorPassword = r.tenantHost ? null : (r.s.password ?? null);
  const pass = tenantPassword ?? operatorPassword ?? '';
  const auth = r.s.user ? { user: r.s.user, pass } : undefined;
  // A login over a non-TLS port must upgrade with STARTTLS or fail: never send the password in clear (round 2).
  return { host: r.s.host, port: r.s.port, secure: r.s.secure, auth, requireTLS: auth !== undefined && !r.s.secure, tenantHost: r.tenantHost };
}

export function createSmtpChannel(options: SmtpChannelOptions): OutboundChannel {
  return {
    channel: 'email',
    async send(envelope: OutboundEnvelope, credentials: string | null): Promise<SendOutcome> {
      if (envelope.content.kind !== 'email') return { kind: 'permanent', reason: 'wrong_content_kind' };
      const settings = smtpLogin(envelope.account, options.defaults, options.allowTenantHost === true, credentials);
      if (!settings) return { kind: 'not_sent_retryable', reason: 'smtp_not_configured' };
      const mail: EmailContent = envelope.content;
      if (!settings.tenantHost && !senderAllowed(mail.from.address, options.defaults)) return { kind: 'not_sent_retryable', reason: 'smtp_sender_not_allowed' };
      // A business-chosen host: resolve once, refuse internal addresses, and connect to THAT address (no second
      // lookup that DNS rebinding could change); TLS still checks the certificate against the host name.
      let connectTo = settings.host;
      if (settings.tenantHost) {
        const pinned = await pinnedAddress(settings.host, options.tenantAddressAllowed);
        if (pinned === null) return { kind: 'not_sent_retryable', reason: 'smtp_host_refused' };
        connectTo = pinned;
      }
      const transport = nodemailer.createTransport({
        host: connectTo,
        servername: settings.host,
        port: settings.port,
        secure: settings.secure,
        requireTLS: settings.requireTLS,
        auth: settings.auth,
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
          ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
          // RFC 8058 one-click unsubscribe (nodemailer `list` option + the POST header). Must be DKIM-signed by
          // the sending domain to be honoured by receivers (RFC 8058 section 4); that is the tenant's mail setup.
          ...(mail.listUnsubscribe
            ? { list: { unsubscribe: mail.listUnsubscribe }, headers: { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } }
            : {}),
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
  return { host: env.SMTP_HOST, port: Number(env.SMTP_PORT || 587), secure: env.SMTP_SECURE === 'true', user: env.SMTP_USER || null, password: env.SMTP_PASSWORD || null, allowedFromDomains: fromDomainsFromEnv(env) };
}

/** RESEND_API_KEY set = Resend's HTTP API; otherwise SMTP. One account for every tenant either way. */
export function emailChannelFromEnv(env: Readonly<Record<string, string | undefined>>, timeoutMs: number): OutboundChannel {
  if (env.RESEND_API_KEY) return createResendChannel({ apiKey: env.RESEND_API_KEY, timeoutMs, allowedFromDomains: fromDomainsFromEnv(env) });
  return createSmtpChannel({ defaults: smtpDefaultsFromEnv(env), timeoutMs, allowTenantHost: env.SMTP_ALLOW_TENANT_HOST === 'true' });
}
export * from './imap.ts';
export * from './imap-store.ts';
export * from './net-guard.ts';
export * from './resend.ts';
export * from './sender.ts';
