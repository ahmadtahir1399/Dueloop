import { KeyRound } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { ApiKeyForm } from "../forms";
import { UntrustedText } from "@/components/untrusted-text";
import { Button } from "@/components/ui/button";
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
    <div className="grid max-w-3xl gap-6">
      <PageHeader title="API keys" description="Keys let your accounting system push invoices (POST /v1/invoices). A key is shown once, when it is created." />
      {(data ?? []).length === 0 ? (
        <EmptyState title="No API keys" icon={KeyRound}>
          Create a key to send invoices from your own system.
        </EmptyState>
      ) : null}
      <ul className="grid gap-2 t-body-sm" data-testid="key-list">
        {(data ?? []).map((k) => (
          <li key={k.id} className="card-edge flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-panel p-4">
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
      <section aria-label="Create key" className="card-edge rounded-xl border border-line bg-panel p-5">
        <ApiKeyForm />
      </section>
    </div>
  );
}
