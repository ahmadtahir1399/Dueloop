import { can } from "@dueloop/authz";
import { SecretOnceForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { mailboxStatus } from "@/lib/data/mailbox";
import { requirePermission } from "@/lib/session";
import { formatInstant } from "@/lib/time";
import { integrationAction } from "../admin-actions";
import { ChoiceSelect } from "@/components/ui/choice-select";

// Connection STATUS only. Secrets can be set or replaced, never read back (issue N); webhook URLs carry an opaque
// token and are shown once, to an owner, when created or rotated.
type ChannelRow = { channel: string; config: unknown };

/** Poller failure codes (private.imap_cursors.last_error) in plain words. */
const MAILBOX_PROBLEMS: Record<string, string> = {
  host_refused: "This server cannot reach that mail server. Check the host name; internal addresses are refused.",
  login_failed: "The mail server refused the login. Check the login and password. Most providers need an app password, and IMAP switched on.",
  connect_failed: "Could not connect securely to the mail server. Check the host name and port; the server must offer TLS.",
  mailbox_not_found: "Connected, but that folder does not exist.",
  poll_failed: "Reading the mailbox failed. It is tried again automatically.",
};

function textOf(config: unknown, key: string): string {
  const v = config && typeof config === "object" ? (config as Record<string, unknown>)[key] : undefined;
  return typeof v === "string" ? v : "";
}

function configValue(rows: ChannelRow[] | null, channel: string, key: string): unknown {
  const config = rows?.find((r) => r.channel === channel)?.config;
  return config && typeof config === "object" ? (config as Record<string, unknown>)[key] : undefined;
}

/** A non-secret value from a channel's config, as text (never rendered as HTML). */
function configOf(rows: ChannelRow[] | null, channel: string, key: string): string {
  const v = configValue(rows, channel, key);
  return typeof v === "string" ? v : "";
}

function configSummary(channel: string, config: unknown): string {
  const rows = [{ channel, config }];
  if (channel === "email") return configOf(rows, "email", "from_address") ? ` · sender ${configOf(rows, "email", "from_address")}` : " · no sender address";
  if (channel === "whatsapp") return configOf(rows, "whatsapp", "phone_number_id") ? " · phone number ID set" : " · no phone number ID";
  return "";
}

export default async function IntegrationsPage() {
  const ctx = await requirePermission("integrations.view");
  const [channels, payments] = await Promise.all([
    ctx.supabase.from("channel_accounts").select("channel, enabled, secret_id, config, imap_config").eq("tenant_id", ctx.tenant.id).order("channel"),
    ctx.supabase.from("payment_accounts").select("provider, mode, enabled").eq("tenant_id", ctx.tenant.id),
  ]);
  if (channels.error || payments.error) throw new Error("could not load integrations");
  const owner = can(ctx.role, "integrations.manage");
  // The operator decides whether a business may use its own mail server (SSRF: the worker connects wherever it says).
  const tenantSmtp = process.env.SMTP_ALLOW_TENANT_HOST === "true";
  const whatsappWired = Boolean(process.env.WHATSAPP_GRAPH_VERSION);
  // The same decision for reading a mailbox: the poller connects to a host the business names.
  const tenantImap = process.env.IMAP_ALLOW_TENANT_HOST === "true";
  const imap = channels.data?.find((c) => c.channel === "email")?.imap_config ?? null;
  const status = owner && imap ? await mailboxStatus(ctx) : null;
  return (
    <div className="grid max-w-2xl gap-4">
      <h1 className="t-display-lg text-ink">Integrations</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Channels</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          {(channels.data ?? []).map((c) => (
            <p key={c.channel} data-channel={c.channel}>
              {c.channel}: {c.enabled ? "enabled" : "disabled"} · {c.secret_id ? "credentials set" : "no credentials"}
              {configSummary(c.channel, c.config)}
              {c.channel === "whatsapp" && !whatsappWired ? " · WhatsApp is not switched on for this server (WHATSAPP_GRAPH_VERSION)" : ""}
            </p>
          ))}
          {owner ? (
            <SecretOnceForm action={integrationAction} label="Set channel credentials">
              <input type="hidden" name="op" value="channel_secret" />
              <label className="grid gap-1">
                Channel
                <ChoiceSelect
                  name="channel"
                  defaultValue="whatsapp"
                  options={[
                    ...(tenantSmtp ? [{ value: "email", label: "email (password for your own mail server)" }] : []),
                    { value: "whatsapp", label: "whatsapp (access token)" },
                    { value: "slack", label: "slack (webhook URL)" },
                  ]}
                />
              </label>
              <label className="grid gap-1">
                Secret
                <Input name="secret" type="password" autoComplete="off" required />
              </label>
              <Button type="submit" className="w-fit">
                Save secret
              </Button>
            </SecretOnceForm>
          ) : null}
          {owner ? (
            <>
              <SecretOnceForm action={integrationAction} label="Email sender">
                <input type="hidden" name="op" value="channel_config" />
                <input type="hidden" name="channel" value="email" />
                <label className="grid gap-1">
                  Sender email address
                  <Input name="from_address" type="email" autoComplete="off" required defaultValue={configOf(channels.data, "email", "from_address")} />
                </label>
                <label className="grid gap-1">
                  Sender name (optional; the business name is used when empty)
                  <Input name="from_name" autoComplete="off" maxLength={100} defaultValue={configOf(channels.data, "email", "from_name")} />
                </label>
                <p className="text-muted-foreground">Use an address your email service has verified.</p>
                {tenantSmtp ? (
                  <fieldset className="grid gap-2 rounded-md border p-2">
                    <legend className="px-1">Your own mail server (optional; empty = the server's)</legend>
                    <label className="grid gap-1">
                      Mail server
                      <Input name="smtp_host" autoComplete="off" defaultValue={configOf(channels.data, "email", "smtp_host")} />
                    </label>
                    <label className="grid gap-1">
                      Port
                      <Input name="smtp_port" inputMode="numeric" autoComplete="off" defaultValue={String(configValue(channels.data, "email", "smtp_port") ?? "587")} />
                    </label>
                    <label className="grid gap-1">
                      Login
                      <Input name="smtp_user" autoComplete="off" defaultValue={configOf(channels.data, "email", "smtp_user")} />
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" name="smtp_secure" defaultChecked={configValue(channels.data, "email", "smtp_secure") === true} />
                      TLS from the start (port 465)
                    </label>
                  </fieldset>
                ) : null}
                <Button type="submit" className="w-fit">
                  Save sender
                </Button>
              </SecretOnceForm>
              <SecretOnceForm action={integrationAction} label="WhatsApp number">
                <input type="hidden" name="op" value="channel_config" />
                <input type="hidden" name="channel" value="whatsapp" />
                <label className="grid gap-1">
                  Phone number ID (from Meta, digits only)
                  <Input name="phone_number_id" inputMode="numeric" autoComplete="off" required defaultValue={configOf(channels.data, "whatsapp", "phone_number_id")} />
                </label>
                <Button type="submit" className="w-fit">
                  Save WhatsApp number
                </Button>
              </SecretOnceForm>
            </>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Customer email replies</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          {!tenantImap ? (
            <p data-testid="mailbox-status">Email replies are not read on this server (IMAP_ALLOW_TENANT_HOST). They go to your sender address; read them there.</p>
          ) : (
            <>
              <p data-testid="mailbox-status">
                {imap ? `Reading ${textOf(imap, "mailbox")} at ${textOf(imap, "host")}` : "No mailbox connected: replies go to your sender address, and the app does not see them."}
                {imap && status?.lastOkAt ? ` · last checked ${formatInstant(status.lastOkAt.toISOString(), ctx.tenant.timezone)}` : ""}
                {imap && !status?.lastOkAt && !status?.lastError ? " · waiting for the first check" : ""}
              </p>
              {status?.lastError ? (
                <p role="alert" className="text-destructive">
                  {MAILBOX_PROBLEMS[status.lastError] ?? MAILBOX_PROBLEMS.poll_failed}
                </p>
              ) : null}
              <p className="text-muted-foreground">
                The app only reads this mailbox, and never changes or deletes anything in it. It reads mail that arrives after you connect, from your customers or in reply to your reminders. Anything else is left alone, and stays in your mailbox for you. A mailbox used only for these replies is best.
              </p>
              {owner ? (
                <SecretOnceForm action={integrationAction} label="Connect a mailbox">
                  <input type="hidden" name="op" value="mailbox" />
                  <label className="grid gap-1">
                    Mail server (IMAP)
                    <Input name="imap_host" autoComplete="off" required placeholder="imap.yourbusiness.example" defaultValue={textOf(imap, "host")} />
                  </label>
                  <label className="grid gap-1">
                    Port
                    <select name="imap_port" className="h-9 rounded-md border bg-background px-2" defaultValue={String((imap as { port?: unknown } | null)?.port ?? "993")}>
                      <option value="993">993 (TLS, the usual choice)</option>
                      <option value="143">143 (STARTTLS)</option>
                    </select>
                  </label>
                  <label className="grid gap-1">
                    Login
                    <Input name="imap_user" autoComplete="off" required defaultValue={textOf(imap, "user")} />
                  </label>
                  <label className="grid gap-1">
                    {imap ? "Password (empty = keep the saved one)" : "Password"}
                    <Input name="imap_password" type="password" autoComplete="off" required={!imap} />
                  </label>
                  <label className="grid gap-1">
                    Folder
                    <Input name="imap_mailbox" autoComplete="off" defaultValue={textOf(imap, "mailbox") || "INBOX"} />
                  </label>
                  <label className="grid gap-1">
                    Reply address (optional; use it when this mailbox is not your sender address)
                    <Input name="reply_to" type="email" autoComplete="off" defaultValue={configOf(channels.data, "email", "reply_to")} />
                  </label>
                  <Button type="submit" className="w-fit">
                    Save mailbox
                  </Button>
                </SecretOnceForm>
              ) : null}
              {owner && imap ? (
                <SecretOnceForm action={integrationAction} label="Disconnect the mailbox">
                  <input type="hidden" name="op" value="disconnect_mailbox" />
                  <Button type="submit" size="sm" variant="outline" className="w-fit">
                    Disconnect
                  </Button>
                </SecretOnceForm>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payments</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          {(payments.data ?? []).map((p) => (
            <div key={p.provider} className="flex flex-wrap items-center gap-2">
              <p data-provider={p.provider}>
                {p.provider} ({p.mode}): {p.enabled ? "connected" : "switched off (add the webhook signing secret, or connect again)"}
              </p>
              {owner && p.enabled ? (
                <SecretOnceForm action={integrationAction} label={`Disconnect ${p.provider}`}>
                  <input type="hidden" name="op" value="disconnect_payment" />
                  <input type="hidden" name="provider" value={p.provider} />
                  <Button type="submit" size="sm" variant="outline" className="w-fit">
                    Disconnect
                  </Button>
                </SecretOnceForm>
              ) : null}
            </div>
          ))}
          {owner ? (
            <>
              <SecretOnceForm action={integrationAction} label="Connect a payment account">
                <input type="hidden" name="op" value="connect_payment" />
                <label className="grid gap-1">
                  Provider
                  <ChoiceSelect
                    name="provider"
                    defaultValue="stripe"
                    options={[{ value: "stripe", label: "Stripe" }, ...(process.env.PAYMENTS_ALLOW_FAKE === "true" ? [{ value: "fake", label: "Fake gateway (tests only)" }] : [])]}
                  />
                </label>
                <label className="grid gap-1">
                  Mode
                  <ChoiceSelect name="mode" defaultValue="test" options={[{ value: "test", label: "test" }, { value: "live", label: "live" }]} />
                </label>
                <label className="grid gap-1">
                  API key
                  <Input name="api_key" type="password" autoComplete="off" required />
                </label>
                <label className="grid gap-1">
                  Webhook signing secret (optional now; you can add it after creating the webhook)
                  <Input name="webhook_secret" type="password" autoComplete="off" />
                </label>
                <Button type="submit" className="w-fit">
                  Connect
                </Button>
              </SecretOnceForm>
              {(payments.data ?? []).length > 0 ? (
                <SecretOnceForm action={integrationAction} label="Webhook signing secret">
                  <input type="hidden" name="op" value="webhook_secret" />
                  <label className="grid gap-1">
                    Payment account
                    <ChoiceSelect name="provider" options={(payments.data ?? []).map((p) => ({ value: p.provider, label: `${p.provider} (${p.mode})` }))} />
                  </label>
                  <label className="grid gap-1">
                    Signing secret
                    <Input name="webhook_secret" type="password" autoComplete="off" required />
                  </label>
                  <Button type="submit" className="w-fit">
                    Save signing secret
                  </Button>
                </SecretOnceForm>
              ) : null}
              {(payments.data ?? []).length > 0 ? (
              <SecretOnceForm action={integrationAction} label="Rotate the webhook URL">
                <input type="hidden" name="op" value="rotate_webhook" />
                <label className="grid gap-1">
                  Payment account
                  <ChoiceSelect name="provider" options={(payments.data ?? []).map((p) => ({ value: p.provider, label: `${p.provider} (${p.mode})` }))} />
                </label>
                <Button type="submit" variant="outline" className="w-fit">
                  Rotate webhook URL
                </Button>
              </SecretOnceForm>
              ) : null}
            </>
          ) : (
            <p className="text-muted-foreground">Only an owner can connect accounts or see webhook URLs.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
