import { can } from "@dueloop/authz";
import { SecretOnceForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { requirePermission } from "@/lib/session";
import { integrationAction } from "../admin-actions";

// Connection STATUS only. Secrets can be set or replaced, never read back (issue N); webhook URLs carry an opaque
// token and are shown once, to an owner, when created or rotated.
export default async function IntegrationsPage() {
  const ctx = await requirePermission("integrations.view");
  const [channels, payments] = await Promise.all([
    ctx.supabase.from("channel_accounts").select("channel, enabled, secret_id").eq("tenant_id", ctx.tenant.id).order("channel"),
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
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payments</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          {(payments.data ?? []).map((p) => (
            <p key={p.provider} data-provider={p.provider}>
              {p.provider} ({p.mode}): {p.enabled ? "connected" : "disabled"}
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
                  Webhook signing secret
                  <Input name="webhook_secret" type="password" autoComplete="off" required />
                </label>
                <Button type="submit" className="w-fit">
                  Connect
                </Button>
              </SecretOnceForm>
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
