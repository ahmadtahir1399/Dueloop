// Non-secret channel settings an owner can edit (Settings > Integrations, "Channel settings"): the email sender
// and the WhatsApp phone number id. Pure validation; lib/trusted/admin.ts saves the result after a database owner
// check. The keys are the ones the worker and the webhook runtime read (worker process.ts / receipts.ts:
// from_address, from_name; adapters-whatsapp: phone_number_id; webhooks store.ts: external_account_id).
import { isSafeAddress, sanitiseDisplayName } from "@dueloop/messaging";

export type ChannelConfigInput = { channel: "email"; fromAddress: string; fromName: string } | { channel: "whatsapp"; phoneNumberId: string };

export type ChannelConfigResult =
  | { ok: true; channel: "email" | "whatsapp"; config: Record<string, string>; externalAccountId: string | null }
  | { ok: false; reason: string };

export function channelConfigFrom(i: ChannelConfigInput): ChannelConfigResult {
  if (i.channel === "email") {
    const address = i.fromAddress.trim();
    if (address.length > 254 || !isSafeAddress(address)) return { ok: false, reason: "Enter one plain email address, like billing@yourbusiness.example." };
    const name = sanitiseDisplayName(i.fromName);
    return { ok: true, channel: "email", config: name ? { from_address: address, from_name: name } : { from_address: address }, externalAccountId: null };
  }
  if (i.channel === "whatsapp") {
    const id = i.phoneNumberId.trim();
    if (!/^\d{1,32}$/.test(id)) return { ok: false, reason: "The phone number ID is the number Meta shows (digits only), not the phone number." };
    return { ok: true, channel: "whatsapp", config: { phone_number_id: id }, externalAccountId: id };
  }
  return { ok: false, reason: "Choose email or WhatsApp." };
}
