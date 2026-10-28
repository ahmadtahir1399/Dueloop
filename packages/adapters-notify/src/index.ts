// Owner/operator alerts. Alerts carry ids, numbers and reason codes only (rule 20), never bodies or contacts.
// Every notifier here is best effort and never throws: an alert outage must not fail a job.
import type { Alert } from '@dueloop/messaging';

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

/** Sends every alert to each sink; one failing sink never stops the others. */
export function fanout(...sinks: AlertSink[]): AlertSink {
  return {
    async notify(alert) {
      await Promise.all(sinks.map((s) => s.notify(alert).catch(() => undefined)));
    },
  };
}
