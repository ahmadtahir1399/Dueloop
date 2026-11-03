import { can, type PermissionId } from "@dueloop/authz";
import { requireTenant } from "@/lib/session";
import { SettingsNav } from "./settings-nav";

const SECTIONS: { href: string; label: string; permission: PermissionId }[] = [
  { href: "/settings", label: "General", permission: "settings.view" },
  { href: "/settings/policies", label: "Policies", permission: "settings.view" },
  { href: "/settings/templates", label: "Templates", permission: "settings.view" },
  { href: "/settings/holidays", label: "Holidays", permission: "settings.view" },
  { href: "/settings/members", label: "Members", permission: "members.view" },
  { href: "/settings/integrations", label: "Integrations", permission: "integrations.view" },
  { href: "/settings/api-keys", label: "API keys", permission: "api_keys.manage" },
];

/** S17–S23 template: sub-nav lists only sections the role can view (left on desktop, scrollable tabs on mobile). */
export default async function SettingsLayout({ children }: LayoutProps<"/settings">) {
  const ctx = await requireTenant();
  const sections = SECTIONS.filter((s) => can(ctx.role, s.permission)).map(({ href, label }) => ({ href, label }));
  return (
    <div className="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
      <SettingsNav sections={sections} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
