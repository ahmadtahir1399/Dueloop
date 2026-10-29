import { can } from "@dueloop/authz";
import { SecretOnceForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { requirePermission } from "@/lib/session";
import { integrationAction } from "../admin-actions";

// Connection STATUS only. Secrets can be set or replaced, never read back (issue N); webhook URLs carry an opaque
// token and are shown once, to an owner, when created or rotated.
type ChannelRow = { channel: string; config: unknown };

/** A non-secret value from a channel's config, as text (never rendered as HTML). */
function configOf(rows: ChannelRow[] | null, channel: string, key: string): string {
  const config = rows?.find((r) => r.channel === channel)?.config;
  const v = config && typeof config === "object" ? (config as Record<string, unknown>)[key] : undefined;
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
    ctx.supabase.from("channel_accounts").select("channel, enabled, secret_id, config").eq("tenant_id", ctx.tenant.id).order("channel"),
    ctx.supabase.from("payment_accounts").select("provider, mode, enabled").eq("tenant_id", ctx.tenant.id),
  ]);
  if (channels.error || payments.error) throw new Error("could not load integrations");
  const owner = can(ctx.role, "integrations.manage");
  return (
    <div className="grid max-w-2xl gap-4">
      <h1 className="text-xl font-semibold">Integrations</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Channels</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          {(channels.data ?? []).map((c) => (
            <p key={c.channel} data-channel={c.channel}>
              {c.channel}: {c.enabled ? "enabled" : "disabled"} · {c.secret_id ? "credentials set" : "no credentials"}
              {configSummary(c.channel, c.config)}
            </p>
          ))}
          {owner ? (
            <SecretOnceForm action={integrationAction} label="Set channel credentials">
              <input type="hidden" name="op" value="channel_secret" />
              <label className="grid gap-1">
                Channel
                <select name="channel" className="h-9 rounded-md border bg-background px-2">
                  <option value="email">email (SMTP password)</option>
                  <option value="whatsapp">whatsapp (access token)</option>
                  <option value="slack">slack (webhook URL)</option>
                </select>
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
          <CardTitle className="text-base">Payments</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          {(payments.data ?? []).map((p) => (
            <p key={p.provider} data-provider={p.provider}>
              {p.provider} ({p.mode}): {p.enabled ? "connected" : "switched off, waiting for the webhook signing secret"}
            </p>
          ))}
          {owner ? (
            <>
              <SecretOnceForm action={integrationAction} label="Connect a payment account">
                <input type="hidden" name="op" value="connect_payment" />
                <label className="grid gap-1">
                  Provider
                  <select name="provider" className="h-9 rounded-md border bg-background px-2">
                    <option value="stripe">Stripe</option>
                    <option value="fake">Fake gateway (tests only)</option>
                  </select>
                </label>
                <label className="grid gap-1">
                  Mode
                  <select name="mode" className="h-9 rounded-md border bg-background px-2">
                    <option value="test">test</option>
                    <option value="live">live</option>
                  </select>
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
                    <select name="provider" className="h-9 rounded-md border bg-background px-2">
                      {(payments.data ?? []).map((p) => (
                        <option key={p.provider} value={p.provider}>
                          {p.provider} ({p.mode})
                        </option>
                      ))}
                    </select>
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
              <SecretOnceForm action={integrationAction} label="Rotate the webhook URL">
                <input type="hidden" name="op" value="rotate_webhook" />
                <Button type="submit" variant="outline" className="w-fit">
                  Rotate webhook URL
                </Button>
              </SecretOnceForm>
            </>
          ) : (
            <p className="text-muted-foreground">Only an owner can connect accounts or see webhook URLs.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
