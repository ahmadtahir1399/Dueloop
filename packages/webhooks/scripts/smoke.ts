// pnpm smoke:whatsapp-webhook — manual, gated check of a DEPLOYED webhook endpoint (never in CI).
// Needs WEBHOOK_SMOKE=1, WEBHOOK_URL (the public https URL Meta calls), WHATSAPP_VERIFY_TOKEN and
// WHATSAPP_APP_SECRET. It runs the GET handshake, a correctly signed POST (a payload built from Meta's
// messages/text reference, for a phone_number_id nobody owns, so nothing is stored), and an unsigned POST
// that must be rejected. Live delivery FROM Meta (App Dashboard -> Webhooks -> Test) is a manual step.
import { signMeta } from '../src/signature.ts';

const env = process.env;
if (env.WEBHOOK_SMOKE !== '1') {
  console.log('smoke:whatsapp-webhook skipped (set WEBHOOK_SMOKE=1, WEBHOOK_URL, WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET).');
  process.exit(0);
}
const url = env.WEBHOOK_URL ?? '';
const token = env.WHATSAPP_VERIFY_TOKEN ?? '';
const secret = env.WHATSAPP_APP_SECRET ?? '';
if (!url || !token || !secret) {
  console.error('missing WEBHOOK_URL, WHATSAPP_VERIFY_TOKEN or WHATSAPP_APP_SECRET');
  process.exit(2);
}
const results: [string, boolean][] = [];
const hs = await fetch(`${url}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(token)}&hub.challenge=424242`);
results.push(['GET handshake echoes the challenge', hs.status === 200 && (await hs.text()) === '424242']);
const body = JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [{ id: 'SMOKE', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: '000000000000000' }, messages: [{ from: '15550000000', id: `wamid.smoke.${Date.now()}`, timestamp: '1760950000', type: 'text', text: { body: 'smoke' } }] } }] }],
});
const signed = await fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signMeta(body, secret) } });
results.push(['signed POST accepted (200)', signed.status === 200]);
const unsigned = await fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
results.push(['unsigned POST rejected (401)', unsigned.status === 401]);
for (const [name, ok] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
process.exit(results.every(([, ok]) => ok) ? 0 : 1);
