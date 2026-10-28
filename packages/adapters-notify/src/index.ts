// Owner/operator alerts. Alerts carry ids, numbers and reason codes only (rule 20), never bodies or contacts.
// Every notifier here is best effort and never throws: an alert outage must not fail a job.
import { isSafeAddress, messageIdFor, sanitiseHeaderValue, type Alert, type OutboundChannel } from '@dueloop/messaging';

export interface AlertSink {
  notify(alert: Alert): Promise<void>;
}

export interface SlackNotifierOptions {
  /** The tenant's incoming-webhook URL (a Vault secret: the URL itself is the credential). */
  readonly webhookFor: (tenantId: string) => Promise<string | null>;
  readonly timeoutMs: number;
  readonly fetch?: typeof fetch;
  /** Reports delivery problems without the URL (e.g. to the JSON logger). */
  readonly onError?: (reason: string) => void;
}

const EMOJI: Record<Alert['severity'], string> = { info: ':information_source:', warning: ':warning:', critical: ':rotating_light:' };

/** Slack mrkdwn needs &, < and > escaped; nothing in an alert may become a link or a mention. */
export function escapeSlack(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function slackText(alert: Alert): string {
  return [`${EMOJI[alert.severity]} *${escapeSlack(alert.title)}*`, ...alert.lines.map((l) => `• ${escapeSlack(l)}`)].join('\n');
}

export function createSlackNotifier(options: SlackNotifierOptions): AlertSink {
  const doFetch = options.fetch ?? fetch;
  const report = options.onError ?? (() => undefined);
  return {
    async notify(alert) {
      try {
        const url = await options.webhookFor(alert.tenantId);
        if (!url) return report('slack_not_configured');
        if (!url.startsWith('https://hooks.slack.com/')) return report('slack_url_rejected');
        const res = await doFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: slackText(alert) }),
          signal: AbortSignal.timeout(options.timeoutMs),
        });
        if (!res.ok) {
          // Slack answers with a plain-text code such as invalid_payload or channel_not_found.
          const code = (await res.text().catch(() => '')).trim();
          report(`slack_${res.status}${/^[a-z_]{1,40}$/.test(code) ? `_${code}` : ''}`);
        }
      } catch {
        report('slack_network');
      }
    },
  };
}

export interface EmailAlertOptions {
  /** The tenant's email channel (the same SMTP adapter reminders use) and its account config. */
  readonly channel: OutboundChannel;
  readonly accountFor: (tenantId: string) => Promise<Readonly<Record<string, unknown>> | null>;
  readonly credentialsFor: (tenantId: string) => Promise<string | null>;
  /** Owner addresses of the tenant (staff, not customers). */
  readonly recipientsFor: (tenantId: string) => Promise<readonly string[]>;
  readonly onError?: (reason: string) => void;
}

/** Plain-text alert email to the tenant owner(s), sent through the tenant's own email account. */
export function createEmailAlertNotifier(options: EmailAlertOptions): AlertSink {
  const report = options.onError ?? (() => undefined);
  return {
    async notify(alert) {
      try {
        const account = await options.accountFor(alert.tenantId);
        const from = typeof account?.from_address === 'string' ? account.from_address : null;
        if (!account || !from || !isSafeAddress(from)) return report('alert_email_not_configured');
        const domain = typeof account.message_id_domain === 'string' ? account.message_id_domain : (from.split('@')[1] ?? 'localhost');
        const credentials = await options.credentialsFor(alert.tenantId);
        for (const [i, to] of (await options.recipientsFor(alert.tenantId)).entries()) {
          if (!isSafeAddress(to)) continue;
          const outcome = await options.channel.send(
            {
              tenantId: alert.tenantId,
              idempotencyKey: `alert:${alert.dedupeKey}`,
              account,
              content: {
                kind: 'email',
                to: { address: to, name: '' },
                from: { address: from, name: 'Dueloop alerts' },
                subject: sanitiseHeaderValue(`[Dueloop] ${alert.title}`),
                text: [alert.title, '', ...alert.lines].join('\n'),
                messageId: messageIdFor(`alert:${alert.dedupeKey}:${i}`, domain),
              },
            },
            credentials,
          );
          if (outcome.kind !== 'sent') report(`alert_email_${outcome.kind}`);
        }
      } catch {
        report('alert_email_error');
      }
    },
  };
}

/** Slack when the tenant has a webhook, otherwise email to the owners (Prompt 3, step 10). */
export function slackOrEmail(hasSlack: (tenantId: string) => Promise<boolean>, slack: AlertSink, email: AlertSink): AlertSink {
  return {
    async notify(alert) {
      const useSlack = await hasSlack(alert.tenantId).catch(() => false);
      await (useSlack ? slack : email).notify(alert).catch(() => undefined);
    },
  };
}

/** Sends every alert to each sink; one failing sink never stops the others. */
export function fanout(...sinks: AlertSink[]): AlertSink {
  return {
    async notify(alert) {
      await Promise.all(sinks.map((s) => s.notify(alert).catch(() => undefined)));
    },
  };
}
