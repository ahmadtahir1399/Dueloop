import { can } from "@dueloop/authz";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { missingStandardTemplates } from "@/lib/default-templates";
import { requirePermission } from "@/lib/session";
import { Input } from "@/components/ui/input";
import { addStandardTemplatesAction, newWhatsAppTemplateAction } from "./actions";
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
  const missing = missingStandardTemplates(data ?? []);
  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">Message templates</h1>
      {missing.length > 0 && can(ctx.role, "templates.edit") ? (
        <Card>
          <CardContent className="pt-6">
            <ActionForm action={addStandardTemplatesAction} label="Standard templates">
              <p className="text-sm">
                Reminders need these email templates, and this business does not have them yet: {missing.join(", ")}.
              </p>
              <Button type="submit" className="w-fit">
                Add the standard email templates
              </Button>
            </ActionForm>
          </CardContent>
        </Card>
      ) : null}
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
      {can(ctx.role, "templates.edit") ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New WhatsApp template</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm action={newWhatsAppTemplateAction} label="New WhatsApp template" className="grid max-w-xl gap-2 text-sm">
              <p className="text-muted-foreground">
                Use the exact text Meta approved. It starts as pending; an owner marks it approved, and only then is it sent.
              </p>
              <label className="grid gap-1">
                Template key (the policy step uses it, for example nudge)
                <Input name="template_key" required maxLength={40} autoComplete="off" />
              </label>
              <label className="grid gap-1">
                Tone
                <select name="tone" className="h-9 rounded-md border bg-background px-2" defaultValue="neutral">
                  <option value="friendly">friendly</option>
                  <option value="neutral">neutral</option>
                  <option value="firm">firm</option>
                </select>
              </label>
              <label className="grid gap-1">
                Customer language
                <Input name="locale" defaultValue="en" maxLength={20} autoComplete="off" />
              </label>
              <label className="grid gap-1">
                Name at Meta
                <Input name="provider_template_name" required autoComplete="off" />
              </label>
              <label className="grid gap-1">
                Language code at Meta
                <Input name="provider_language" required defaultValue="en" autoComplete="off" />
              </label>
              <label className="grid gap-1">
                Text (variables like {"{{customer_name}}"})
                <textarea name="body" required maxLength={5000} rows={4} dir="auto" className="rounded-md border bg-background p-2" />
              </label>
              <Button type="submit" className="w-fit">
                Add WhatsApp template
              </Button>
            </ActionForm>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
