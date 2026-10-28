// pnpm smoke:whatsapp — sends ONE real template message through the Cloud API. Never runs in CI.
// Gated: does nothing unless WHATSAPP_SMOKE=1 and every variable below is set. The token is read from the
// environment only and never printed (rule 19).
//   WHATSAPP_GRAPH_VERSION    e.g. the version shown in your Meta app dashboard
//   WHATSAPP_TOKEN            a (test) access token
//   WHATSAPP_PHONE_NUMBER_ID  the sender's phone number id
//   WHATSAPP_SMOKE_TO         an E.164 number that has opted in (your own test number)
//   WHATSAPP_SMOKE_TEMPLATE   an APPROVED template name (e.g. Meta's sample "hello_world")
//   WHATSAPP_SMOKE_LANGUAGE   its language code (e.g. en_US)
import { createWhatsAppChannel } from '../src/index.ts';

const env = process.env;
const need = ['WHATSAPP_GRAPH_VERSION', 'WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_SMOKE_TO', 'WHATSAPP_SMOKE_TEMPLATE', 'WHATSAPP_SMOKE_LANGUAGE'];
if (env.WHATSAPP_SMOKE !== '1') {
  console.log('smoke:whatsapp skipped (set WHATSAPP_SMOKE=1 and the WHATSAPP_* variables to run it).');
  process.exit(0);
}
const missing = need.filter((k) => !env[k]);
if (missing.length) {
  console.error(`smoke:whatsapp: missing ${missing.join(', ')}`);
  process.exit(2);
}
const channel = createWhatsAppChannel({ graphVersion: env.WHATSAPP_GRAPH_VERSION ?? '', timeoutMs: 15_000 });
const outcome = await channel.send(
  {
    tenantId: 'smoke',
    idempotencyKey: 'smoke',
    account: { phone_number_id: env.WHATSAPP_PHONE_NUMBER_ID },
    content: { kind: 'whatsapp_template', to: env.WHATSAPP_SMOKE_TO ?? '', templateName: env.WHATSAPP_SMOKE_TEMPLATE ?? '', languageCode: env.WHATSAPP_SMOKE_LANGUAGE ?? '', parameters: [] },
  },
  env.WHATSAPP_TOKEN ?? null,
);
console.log(JSON.stringify(outcome));
process.exit(outcome.kind === 'sent' ? 0 : 1);
