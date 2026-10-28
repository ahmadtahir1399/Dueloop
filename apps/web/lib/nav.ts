// Navigation items, each tied to a permission in the role matrix (packages/authz). Pure data.
import { can, type PermissionId, type Role } from "@dueloop/authz";

export type CounterKey = "approvals" | "tasks" | "unknownMessages" | "proofs";

export interface NavItem {
  href: string;
  label: string;
  permission: PermissionId;
  counter?: CounterKey;
}

export const NAV: readonly NavItem[] = [
  { href: "/", label: "Overview", permission: "overview.view" },
  { href: "/invoices", label: "Invoices", permission: "invoices.view" },
  { href: "/customers", label: "Customers", permission: "customers.view" },
  { href: "/inbox", label: "Inbox", permission: "inbox.view" },
  { href: "/approvals", label: "Approvals", permission: "approvals.view", counter: "approvals" },
  { href: "/tasks", label: "Tasks", permission: "tasks.view", counter: "tasks" },
  { href: "/proofs", label: "Proofs", permission: "proofs.view", counter: "proofs" },
  { href: "/messages", label: "Unknown sends", permission: "messages.reconcile", counter: "unknownMessages" },
  { href: "/import", label: "Import", permission: "import.run" },
  { href: "/settings", label: "Settings", permission: "settings.view" },
];

export function navFor(role: Role): NavItem[] {
  return NAV.filter((i) => can(role, i.permission));
}
