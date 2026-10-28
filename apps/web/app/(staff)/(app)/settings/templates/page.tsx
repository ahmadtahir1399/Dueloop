import { can } from "@dueloop/authz";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/lib/session";
import { TemplateForm } from "./template-form";

export default async function TemplatesPage() {
  const ctx = await requirePermission("settings.view");
  const { data, error } = await ctx.supabase
    .from("templates")
    .select("id, template_key, channel, locale, tone, subject, body, provider_status")
    .eq("tenant_id", ctx.tenant.id)
    .order("template_key")
    .order("channel");
  if (error) throw new Error("could not load templates");
  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">Message templates</h1>
      {(data ?? []).map((t) => (
        <Card key={t.id} data-template={`${t.template_key}:${t.channel}`}>
          <CardHeader>
            <CardTitle className="text-base">
              {t.template_key} · {t.channel} · {t.locale} · {t.tone}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TemplateForm id={t.id} channel={t.channel} subject={t.subject} body={t.body} status={t.provider_status} canEdit={can(ctx.role, "templates.edit")} canApprove={can(ctx.role, "settings.edit")} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
