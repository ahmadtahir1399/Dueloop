import { ActionForm, SecretOnceForm } from "@/components/action-form";
import { UntrustedText } from "@/components/untrusted-text";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requirePermission } from "@/lib/session";
import { formatInstant } from "@/lib/time";
import { apiKeyAction } from "../admin-actions";

export default async function ApiKeysPage() {
  const ctx = await requirePermission("api_keys.manage");
  // Column grants: the hash column is not even selectable by a signed-in user.
  const { data, error } = await ctx.supabase.from("api_keys").select("id, name, prefix, scopes, created_at, revoked_at, last_used_at").eq("tenant_id", ctx.tenant.id).order("created_at");
  if (error) throw new Error("could not load keys");
  const tz = ctx.tenant.timezone;
  return (
    <div className="grid max-w-2xl gap-4">
      <h1 className="text-xl font-semibold">API keys</h1>
      <p className="text-sm text-muted-foreground">Keys let your accounting system push invoices (POST /v1/invoices). A key is shown once, when it is created.</p>
      <ul className="grid gap-2 text-sm" data-testid="key-list">
        {(data ?? []).map((k) => (
          <li key={k.id} className="flex flex-wrap items-center gap-3 rounded-md border p-3">
            <span>
              <UntrustedText text={k.name} /> · dl_{k.prefix}_… · {k.scopes.join(", ")} · created {formatInstant(k.created_at, tz)}
              {k.last_used_at ? ` · last used ${formatInstant(k.last_used_at, tz)}` : " · never used"}
              {k.revoked_at ? ` · revoked ${formatInstant(k.revoked_at, tz)}` : ""}
            </span>
            {!k.revoked_at ? (
              <ActionForm action={apiKeyAction} label={`Revoke ${k.name}`} className="inline">
                <input type="hidden" name="key" value={k.id} />
                <Button type="submit" name="op" value="revoke" size="sm" variant="outline">
                  Revoke
                </Button>
              </ActionForm>
            ) : null}
          </li>
        ))}
      </ul>
      <SecretOnceForm action={apiKeyAction} label="Create an API key">
        <label className="grid gap-1 text-sm">
          Name
          <Input name="name" required maxLength={80} />
        </label>
        <Button type="submit" name="op" value="create" className="w-fit">
          Create key
        </Button>
      </SecretOnceForm>
    </div>
  );
}
