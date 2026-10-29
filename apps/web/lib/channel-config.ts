// Non-secret channel settings an owner can edit (Settings > Integrations, "Channel settings"): the email sender
// and the WhatsApp phone number id. Pure validation; lib/trusted/admin.ts saves the result after a database owner
// check. The keys are the ones the worker and the webhook runtime read (worker process.ts / receipts.ts:
// from_address, from_name; adapters-whatsapp: phone_number_id; webhooks store.ts: external_account_id).
import { isSafeAddress, sanitiseDisplayName } from "@dueloop/messaging";

/** The business's own SMTP server: only offered when the operator sets SMTP_ALLOW_TENANT_HOST=true (SSRF). */
export interface TenantSmtpInput {
  host: string;
  port: string;
  user: string;
  secure: boolean;
}

export type ChannelConfigInput =
  | { channel: "email"; fromAddress: string; fromName: string; smtp?: TenantSmtpInput | undefined }
  | { channel: "whatsapp"; phoneNumberId: string };

export type ChannelConfigResult =
  | { ok: true; channel: "email" | "whatsapp"; config: Record<string, string | number | boolean>; externalAccountId: string | null }
  | { ok: false; reason: string };

// eslint-disable-next-line no-control-regex -- refusing control characters is the point
const CONTROL = /[\u0000-\u001F\u007F]/;
const HOSTNAME = /^(?=.{1,253}$)[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

/** Same rule as the worker's email adapter (senderAllowed): SMTP_FROM_DOMAINS, when set, lists the allowed domains. */
export function senderDomainAllowed(address: string, fromDomainsEnv: string | undefined): boolean {
  const allowed = (fromDomainsEnv ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d !== "");
  return allowed.length === 0 || allowed.includes(address.split("@").at(-1)?.toLowerCase() ?? "");
}

export function channelConfigFrom(i: ChannelConfigInput): ChannelConfigResult {
  if (i.channel === "email") {
    const address = i.fromAddress.trim();
    if (address.length > 254 || !isSafeAddress(address)) return { ok: false, reason: "Enter one plain email address, like billing@yourbusiness.example." };
    const name = sanitiseDisplayName(i.fromName);
    const config: Record<string, string | number | boolean> = name ? { from_address: address, from_name: name } : { from_address: address };
    if (i.smtp) {
      const host = i.smtp.host.trim();
      const port = Number(i.smtp.port);
      const user = i.smtp.user.trim();
      if (!HOSTNAME.test(host)) return { ok: false, reason: "The mail server is a host name like smtp.yourbusiness.example." };
      if (!/^\d{1,5}$/.test(i.smtp.port.trim()) || port < 1 || port > 65535) return { ok: false, reason: "The port is a number like 587 or 465." };
      if (user.length < 1 || user.length > 254 || CONTROL.test(user)) return { ok: false, reason: "Enter the mail server login (often your email address)." };
      Object.assign(config, { smtp_host: host, smtp_port: port, smtp_user: user, smtp_secure: i.smtp.secure });
    }
    return { ok: true, channel: "email", config, externalAccountId: null };
  }
  if (i.channel === "whatsapp") {
    const id = i.phoneNumberId.trim();
    if (!/^\d{1,32}$/.test(id)) return { ok: false, reason: "The phone number ID is the number Meta shows (digits only), not the phone number." };
    return { ok: true, channel: "whatsapp", config: { phone_number_id: id }, externalAccountId: id };
  }
  return { ok: false, reason: "Choose email or WhatsApp." };
}
