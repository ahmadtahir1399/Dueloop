import { describe, expect, it } from 'vitest';
import type { Alert } from '@dueloop/messaging';
import { createSlackNotifier, fanout, slackText } from '../src/index.ts';

const alert: Alert = { tenantId: 't1', dedupeKey: 'k', kind: 'message_unknown', severity: 'critical', title: 'Invoice <INV-1> & co', lines: ['key: a:s1:email'] };
const HOOK = 'https://hooks.slack.com/services/T000/B000/XXXX';

function fake(status: number, text = 'ok') {
  const calls: { url: string; body: string }[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body) });
    return new Response(text, { status });
  }) as typeof fetch;
  return { f, calls };
}

describe('Slack notifier contract', () => {
  it('posts {"text"} as JSON to the tenant webhook, escaped', async () => {
    const { f, calls } = fake(200);
    await createSlackNotifier({ webhookFor: async () => HOOK, timeoutMs: 100, fetch: f }).notify(alert);
    expect(calls[0]?.url).toBe(HOOK);
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({ text: slackText(alert) });
    expect(slackText(alert)).toContain('Invoice &lt;INV-1&gt; &amp; co');
  });

  it('error codes are reported without the URL; never throws', async () => {
    const errors: string[] = [];
    const { f } = fake(404, 'channel_not_found');
    await createSlackNotifier({ webhookFor: async () => HOOK, timeoutMs: 100, fetch: f, onError: (r) => errors.push(r) }).notify(alert);
    const boom = (async () => {
      throw new Error(`connect failed ${HOOK}`);
    }) as typeof fetch;
    await createSlackNotifier({ webhookFor: async () => HOOK, timeoutMs: 100, fetch: boom, onError: (r) => errors.push(r) }).notify(alert);
    expect(errors).toEqual(['slack_404_channel_not_found', 'slack_network']);
    expect(errors.join()).not.toContain('hooks.slack.com');
  });

  it('only hooks.slack.com URLs are called; no webhook -> nothing sent', async () => {
    const { f, calls } = fake(200);
    const errors: string[] = [];
    await createSlackNotifier({ webhookFor: async () => 'http://169.254.169.254/latest', timeoutMs: 100, fetch: f, onError: (r) => errors.push(r) }).notify(alert);
    await createSlackNotifier({ webhookFor: async () => null, timeoutMs: 100, fetch: f, onError: (r) => errors.push(r) }).notify(alert);
    expect(calls).toHaveLength(0);
    expect(errors).toEqual(['slack_url_rejected', 'slack_not_configured']);
  });

  it('fanout isolates a throwing sink', async () => {
    const seen: string[] = [];
    await fanout({ notify: async () => Promise.reject(new Error('x')) }, { notify: async (a) => void seen.push(a.kind) }).notify(alert);
    expect(seen).toEqual(['message_unknown']);
  });
});
