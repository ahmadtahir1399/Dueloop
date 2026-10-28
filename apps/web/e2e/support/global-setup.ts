// Creates the e2e users (auth admin API) and their memberships, then signs each in once through the UI and saves
// the session for the tests. Idempotent: re-running updates passwords and memberships.
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { closeDb, db } from "./db";
import { BASE_URL, stack } from "./stack";
import { authFile, E2E_PASSWORD, USERS, type E2eUser } from "./users";

export async function ensureUsers(): Promise<Record<E2eUser, string>> {
  const s = stack();
  const admin = createClient(s.apiUrl, s.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const ids = {} as Record<E2eUser, string>;
  const existing = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (existing.error) throw new Error("listUsers failed");
  for (const [key, u] of Object.entries(USERS) as [E2eUser, (typeof USERS)[E2eUser]][]) {
    const found = existing.data.users.find((x) => x.email === u.email);
    if (found) {
      const upd = await admin.auth.admin.updateUserById(found.id, { password: E2E_PASSWORD, email_confirm: true });
      if (upd.error) throw new Error(`updateUser failed for ${key}`);
      ids[key] = found.id;
    } else {
      const created = await admin.auth.admin.createUser({ email: u.email, password: E2E_PASSWORD, email_confirm: true });
      if (created.error || !created.data.user) throw new Error(`createUser failed for ${key}`);
      ids[key] = created.data.user.id;
    }
    for (const m of u.memberships) {
      await db().query(
        `insert into public.memberships (tenant_id, user_id, role) values ($1, $2, $3)
         on conflict (tenant_id, user_id) do update set role = excluded.role`,
        [m.tenant, ids[key], m.role],
      );
    }
  }
  return ids;
}

export async function signInAndSave(user: E2eUser) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL: BASE_URL });
  await page.goto("/login");
  await page.getByLabel("Email").fill(USERS[user].email);
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
  await page.context().storageState({ path: authFile(user) });
  await browser.close();
}

export default async function globalSetup() {
  mkdirSync("e2e/.auth", { recursive: true });
  await ensureUsers();
  await closeDb();
  for (const u of Object.keys(USERS) as E2eUser[]) await signInAndSave(u);
}
