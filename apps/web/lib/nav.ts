// Navigation items, each tied to a permission in the role matrix (packages/authz). Pure data.
// Groups (redesign §4.2): daily browsing, queues that need a decision, setup.
import { can, type PermissionId, type Role } from "@dueloop/authz";

export type CounterKey = "approvals" | "tasks" | "unknownMessages" | "proofs";
export type NavGroup = "daily" | "decisions" | "setup";
export type NavIcon = "overview" | "invoices" | "customers" | "inbox" | "approvals" | "tasks" | "proofs" | "unknown" | "import" | "settings";

export interface NavItem {
  href: string;
  label: string;
  permission: PermissionId;
  group: NavGroup;
  icon: NavIcon;
  counter?: CounterKey;
}

export const NAV_GROUP_LABEL: Record<NavGroup, string | null> = { daily: null, decisions: "Needs you", setup: "Setup" };

export const NAV: readonly NavItem[] = [
  { href: "/overview", label: "Overview", permission: "overview.view", group: "daily", icon: "overview" },
  { href: "/invoices", label: "Invoices", permission: "invoices.view", group: "daily", icon: "invoices" },
  { href: "/customers", label: "Customers", permission: "customers.view", group: "daily", icon: "customers" },
  { href: "/inbox", label: "Inbox", permission: "inbox.view", group: "daily", icon: "inbox" },
  { href: "/approvals", label: "Approvals", permission: "approvals.view", group: "decisions", icon: "approvals", counter: "approvals" },
  { href: "/tasks", label: "Tasks", permission: "tasks.view", group: "decisions", icon: "tasks", counter: "tasks" },
  { href: "/proofs", label: "Proofs", permission: "proofs.view", group: "decisions", icon: "proofs", counter: "proofs" },
  { href: "/messages", label: "Unknown sends", permission: "messages.reconcile", group: "decisions", icon: "unknown", counter: "unknownMessages" },
  { href: "/import", label: "Import", permission: "import.run", group: "setup", icon: "import" },
  { href: "/settings", label: "Settings", permission: "settings.view", group: "setup", icon: "settings" },
];

export function navFor(role: Role): NavItem[] {
  return NAV.filter((i) => can(role, i.permission));
}

/** "Approvals, 3 waiting" (§8.1): the badge number is part of the link's accessible name. */
export function navAccessibleName(label: string, count: number | undefined): string {
  return count ? `${label}, ${count} waiting` : label;
}

/** Sum of the four queues: the "N things need you" count on Overview. */
export function waitingTotal(counters: Partial<Record<CounterKey, number>>): number {
  return (counters.approvals ?? 0) + (counters.tasks ?? 0) + (counters.proofs ?? 0) + (counters.unknownMessages ?? 0);
}
