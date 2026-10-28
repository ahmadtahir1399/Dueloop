// Test users for the LOCAL stack only (created by global-setup through the auth admin API). The password is a
// local test value, not a credential for anything real.
export const E2E_PASSWORD = "local-e2e-only-9d1f";

export const DEMO_TENANT = "5eed0000-0000-4000-8000-00000000000a";
export const OTHER_TENANT = "5eed0000-0000-4000-8000-00000000000b";

export type E2eUser = "owner" | "accountant" | "collector" | "outsider" | "multi" | "nobody";

export const USERS: Record<E2eUser, { email: string; memberships: { tenant: string; role: "owner" | "accountant" | "collector" }[] }> = {
  owner: { email: "owner@e2e.test", memberships: [{ tenant: DEMO_TENANT, role: "owner" }] },
  accountant: { email: "accountant@e2e.test", memberships: [{ tenant: DEMO_TENANT, role: "accountant" }] },
  collector: { email: "collector@e2e.test", memberships: [{ tenant: DEMO_TENANT, role: "collector" }] },
  outsider: { email: "outsider@e2e.test", memberships: [{ tenant: OTHER_TENANT, role: "owner" }] },
  multi: {
    email: "multi@e2e.test",
    memberships: [
      { tenant: DEMO_TENANT, role: "collector" },
      { tenant: OTHER_TENANT, role: "accountant" },
    ],
  },
  nobody: { email: "nobody@e2e.test", memberships: [] },
};

export const authFile = (u: E2eUser) => `e2e/.auth/${u}.json`;

export interface FixtureIds {
  approvals: Record<"DA-0001" | "DA-0002" | "DA-0003" | "DA-0004", string>;
  tasks: Record<"e2e-claim" | "e2e-parity-ui" | "e2e-parity-cli", string>;
  unknown: Record<"ui" | "cli", string>;
  proofs: Record<"ui" | "cli", string>;
  promise: string;
  hostileCustomer: string;
  hostileInvoice: string;
}
export async function fixtureIds(): Promise<FixtureIds> {
  const { readFileSync } = await import("node:fs");
  return JSON.parse(readFileSync("e2e/.auth/fixtures.json", "utf8")) as FixtureIds;
}
