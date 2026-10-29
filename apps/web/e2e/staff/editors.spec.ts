// Step 10: editors per role (issues K, L, M, N, O).
import { expect, test } from "@playwright/test";
import { db } from "../support/db";
import { authFile, DEMO_TENANT } from "../support/users";

test.describe("accountant", () => {
  test.use({ storageState: authFile("accountant") });

  test("K: policy edit keeps step ids, shows impact and the decide() preview before saving", async ({ page }) => {
    const before = (await db().query("select id, steps from public.policies where tenant_id = $1 and is_default", [DEMO_TENANT])).rows[0];
    await page.goto("/settings/policies");
    const form = page.getByRole("form", { name: /Policy/ }).first();
    await form.getByLabel("Days after due for s1").fill("2");
    await form.getByRole("button", { name: "Save policy" }).isDisabled();
    await form.getByRole("button", { name: "Check impact" }).click();
    const impact = page.getByTestId("policy-impact");
    await expect(impact).toContainText("open invoices use this policy");
    await impact.getByLabel("I checked the impact").check();
    await page.getByRole("button", { name: "Save policy" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
    const after = (await db().query("select steps from public.policies where id = $1", [before.id])).rows[0].steps as { id: string; daysAfterDue: number }[];
    expect(after.map((s) => s.id)).toEqual((before.steps as { id: string }[]).map((s) => s.id));
    expect(after.find((s) => s.id === "s1")?.daysAfterDue).toBe(2);
  });

  test("L: template preview uses the real renderer, warns on threatening wording, footer is read-only", async ({ page }) => {
    await page.goto("/settings/templates");
    const card = page.locator('[data-template="friendly:email"]');
    await card.getByLabel(/Body/).fill("Hello {{customer_name}}. We may take legal action. {{payment_block}}");
    await card.getByRole("button", { name: "Preview" }).click();
    await expect(card.getByTestId("template-preview")).toContainText("Sample Customer Ltd");
    await expect(card.getByTestId("template-preview")).toContainText("To stop these reminders");
    await expect(card.getByTestId("wording-warning")).toContainText("legal action");
    await card.getByLabel(/Body/).fill("Hello {{unknown_var}}");
    await card.getByRole("button", { name: "Save" }).click();
    await expect(card.getByRole("alert")).toContainText("does not render");
  });

  test("L: editing the WhatsApp template body requires resubmission and blocks it until an owner confirms", async ({ page }) => {
    await page.goto("/settings/templates");
    const card = page.locator('[data-template="nudge:whatsapp"]');
    await card.getByLabel(/Body/).fill("Hello {{customer_name}}, invoice {{invoice_number}} is due. {{business_name}}");
    await card.getByRole("button", { name: "Save" }).click();
    await expect(card.getByRole("status").filter({ hasText: "submitted to Meta again" })).toBeVisible();
    const t = await db().query("select provider_status from public.templates where tenant_id = $1 and template_key = 'nudge' and channel = 'whatsapp'", [DEMO_TENANT]);
    expect(t.rows[0].provider_status).toBe("needs_resubmission");
    await expect(page.getByRole("button", { name: "Meta approved this text" })).toHaveCount(0); // accountant cannot
  });

  test("settings and members are read-only for an accountant", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("form", { name: "Change settings" })).toHaveCount(0);
    await page.goto("/settings/members");
    await expect(page.getByRole("button", { name: "Change role" })).toHaveCount(0);
    await page.goto("/settings/api-keys");
    await expect(page.getByText("This page does not exist, or you do not have access to it.")).toBeVisible();
  });
});

test.describe("owner", () => {
  test.use({ storageState: authFile("owner") });

  test("settings are validated by core (bad zone refused); holidays add and remove", async ({ page }) => {
    await page.goto("/settings");
    const f = page.getByRole("form", { name: "Change settings" });
    await f.getByLabel(/Time zone/).fill("GMT+5");
    await f.getByRole("button", { name: "Save settings" }).click();
    await expect(f.getByRole("alert")).toContainText("IANA");
    await page.goto("/settings/holidays");
    await page.getByLabel("Date").fill("2026-12-26");
    await page.getByLabel("Label").fill("Boxing Day <b>x</b>");
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByTestId("holiday-list")).toContainText("Boxing Day <b>x</b>");
  });

  test("M: the last owner cannot be demoted; roles change for others", async ({ page }) => {
    // Demo Agency has two owners (seed + e2e). Demote the seed owner first so e2e owner is the last one.
    await page.goto("/settings/members");
    const seedOwner = page.locator('[data-member="owner@demo-agency.test"]');
    await seedOwner.getByLabel(/Role of/).selectOption("accountant");
    await seedOwner.getByRole("button", { name: "Change role" }).click();
    await expect(seedOwner.getByRole("status")).toContainText("Saved");
    const me = page.locator('[data-member="owner@e2e.test"]');
    await me.getByLabel(/Role of/).selectOption("collector");
    await me.getByRole("button", { name: "Change role" }).click();
    await expect(me.getByRole("alert")).toContainText("at least one owner");
    const owners = await db().query("select count(*)::int as n from public.memberships where tenant_id = $1 and role = 'owner'", [DEMO_TENANT]);
    expect(owners.rows[0].n).toBe(1);
  });

  test("O/N: an API key is shown once; secrets are write-only and never in the page", async ({ page }) => {
    await page.goto("/settings/api-keys");
    await page.getByLabel("Name").fill("ERP sync");
    await page.getByRole("button", { name: "Create key" }).click();
    const secret = (await page.getByTestId("secret-once").locator("code").innerText()).trim();
    expect(secret).toMatch(/^dl_[a-z0-9]{8}_/);
    await page.reload();
    expect(await page.content()).not.toContain(secret.split("_")[2]);
    await expect(page.getByTestId("key-list")).toContainText("ERP sync");

    await page.goto("/settings/integrations");
    const form = page.getByRole("form", { name: "Set channel credentials" });
    // Review round 2: an email password is only offered with SMTP_ALLOW_TENANT_HOST; the WhatsApp token is the same
    // write-only path (set_channel_secret).
    await expect(form.getByLabel("Channel").locator("option", { hasText: "email" })).toHaveCount(0);
    await form.getByLabel("Channel").selectOption("whatsapp");
    await form.getByLabel("Secret").fill("wa-token-e2e-0001");
    await form.getByRole("button", { name: "Save secret" }).click();
    await expect(form.getByRole("status")).toContainText("cannot be shown again");
    await page.reload();
    expect(await page.content()).not.toContain("wa-token-e2e-0001");
    await expect(page.locator('[data-channel="whatsapp"]')).toContainText("credentials set");
  });
});

// Found while writing docs/guides/getting-your-keys.html: nothing in the UI could set the email sender address or
// the WhatsApp phone number id, so a new tenant could not send without database access.
test.describe("owner: channel settings", () => {
  test.use({ storageState: authFile("owner") });

  test("the sender address and the WhatsApp phone number id can be set from Settings > Integrations", async ({ page }) => {
    const before = (await db().query("select channel, config, external_account_id from public.channel_accounts where tenant_id = $1 and channel in ('email', 'whatsapp')", [DEMO_TENANT])).rows;
    try {
      await page.goto("/settings/integrations");
      const sender = page.getByRole("form", { name: "Email sender" });
      await sender.getByLabel("Sender email address").fill("billing@nodot");
      await sender.getByRole("button", { name: "Save sender" }).click();
      await expect(sender.getByRole("alert")).toContainText("one plain email address");
      await sender.getByLabel("Sender email address").fill("accounts@demo-agency.test");
      await sender.getByLabel(/Sender name/).fill("Demo Accounts");
      await sender.getByRole("button", { name: "Save sender" }).click();
      await expect(sender.getByRole("status")).toContainText("Saved");
      const email = (await db().query("select config from public.channel_accounts where tenant_id = $1 and channel = 'email'", [DEMO_TENANT])).rows[0];
      expect(email.config).toMatchObject({ from_address: "accounts@demo-agency.test", from_name: "Demo Accounts" });

      const wa = page.getByRole("form", { name: "WhatsApp number" });
      await wa.getByLabel(/Phone number ID/).fill("+44 7700 900123");
      await wa.getByRole("button", { name: "Save WhatsApp number" }).click();
      await expect(wa.getByRole("alert")).toContainText("digits only");
      await wa.getByLabel(/Phone number ID/).fill("990011223344556");
      await wa.getByRole("button", { name: "Save WhatsApp number" }).click();
      // No WHATSAPP_GRAPH_VERSION / token here, so Meta cannot confirm it: saved for sending, NOT for routing
      // replies (review round 2: otherwise a business could claim another business's number).
      await expect(wa.getByRole("status")).toContainText("only after Meta confirms");
      const row = (await db().query("select config, external_account_id from public.channel_accounts where tenant_id = $1 and channel = 'whatsapp'", [DEMO_TENANT])).rows[0];
      expect(row.config).toMatchObject({ phone_number_id: "990011223344556" });
      expect(row.external_account_id).toBeNull();
    } finally {
      for (const r of before) await db().query("update public.channel_accounts set config = $3, external_account_id = $4 where tenant_id = $1 and channel = $2", [DEMO_TENANT, r.channel, r.config, r.external_account_id]);
      if (!before.some((r) => r.channel === "whatsapp")) await db().query("delete from public.channel_accounts where tenant_id = $1 and channel = 'whatsapp'", [DEMO_TENANT]);
    }
  });
});

// Stripe shows the signing secret only after the webhook endpoint exists, and the app showed the webhook URL only
// after connecting WITH that secret. Now: connect with the API key, get the URL, add the secret afterwards. Until
// then the account is switched off, so no pay link is created that could never be confirmed.
test.describe("owner: two-step payment connect", () => {
  test.use({ storageState: authFile("owner") });

  test("connect without the signing secret stays off; adding the secret switches it on", async ({ page }) => {
    const before = (await db().query("select id from public.payment_accounts where tenant_id = $1 and provider = 'stripe'", [DEMO_TENANT])).rows;
    test.skip(before.length > 0, "the demo tenant already has a Stripe account");
    try {
      await page.goto("/settings/integrations");
      const connect = page.getByRole("form", { name: "Connect a payment account" });
      await connect.getByLabel("API key").fill("rk_test_e2e_two_step_0001");
      await connect.getByRole("button", { name: "Connect" }).click();
      await expect(connect.getByRole("status")).toContainText("switched off until you add the webhook signing secret");
      await expect(connect.getByTestId("secret-once")).toContainText("/webhooks/payments/");
      let acc = (await db().query("select enabled, webhook_secret_id, api_key_secret_id from public.payment_accounts where tenant_id = $1 and provider = 'stripe'", [DEMO_TENANT])).rows[0];
      expect(acc).toMatchObject({ enabled: false, webhook_secret_id: null });
      expect(acc.api_key_secret_id).not.toBeNull();

      await page.reload();
      await expect(page.locator('[data-provider="stripe"]')).toContainText("switched off");
      const finish = page.getByRole("form", { name: "Webhook signing secret" });
      await finish.getByLabel("Signing secret").fill("whsec_e2e_two_step_0001");
      await finish.getByRole("button", { name: "Save signing secret" }).click();
      await expect(finish.getByRole("status")).toContainText("Saved");
      acc = (await db().query("select enabled, webhook_secret_id from public.payment_accounts where tenant_id = $1 and provider = 'stripe'", [DEMO_TENANT])).rows[0];
      expect(acc.enabled).toBe(true);
      expect(acc.webhook_secret_id).not.toBeNull();
      await page.reload();
      expect(await page.content()).not.toContain("whsec_e2e_two_step_0001");
      await expect(page.locator('[data-provider="stripe"]')).toContainText("connected");

      // Review round 2: reconnecting (new key, same mode) keeps the webhook URL Stripe already has and stays on.
      const hash = async () => (await db().query("select webhook_token_hash, enabled, mode from public.payment_accounts where tenant_id = $1 and provider = 'stripe'", [DEMO_TENANT])).rows[0];
      const before = await hash();
      const again = page.getByRole("form", { name: "Connect a payment account" });
      await again.getByLabel("API key").fill("rk_test_e2e_two_step_0002");
      await again.getByRole("button", { name: "Connect" }).click();
      await expect(again.getByRole("status")).toContainText("webhook URL is unchanged");
      await expect(again.getByTestId("secret-once")).toHaveCount(0);
      expect(await hash()).toEqual(before);

      // Switching test -> live needs the live signing secret first: switched off until then.
      await page.reload();
      const live = page.getByRole("form", { name: "Connect a payment account" });
      await live.getByLabel("Mode").selectOption("live");
      await live.getByLabel("API key").fill("rk_live_e2e_two_step_0003");
      await live.getByRole("button", { name: "Connect" }).click();
      await expect(live.getByRole("status")).toContainText("switched off");
      expect(await hash()).toMatchObject({ enabled: false, mode: "live", webhook_token_hash: before.webhook_token_hash });

      // An owner can switch an account off.
      await page.getByRole("form", { name: "Webhook signing secret" }).getByLabel("Signing secret").fill("whsec_e2e_two_step_live");
      await page.getByRole("form", { name: "Webhook signing secret" }).getByRole("button", { name: "Save signing secret" }).click();
      await expect.poll(async () => (await hash()).enabled).toBe(true);
      await page.reload();
      await page.getByRole("form", { name: "Disconnect stripe" }).getByRole("button", { name: "Disconnect" }).click();
      await expect.poll(async () => (await hash()).enabled).toBe(false);
    } finally {
      await db().query("delete from public.payment_accounts where tenant_id = $1 and provider = 'stripe'", [DEMO_TENANT]);
    }
  });
});

test.describe("owner: integration input checks", () => {
  test.use({ storageState: authFile("owner") });

  test("a wrong Slack URL, a Stripe key of the other mode and the test-only gateway are refused", async ({ page }) => {
    await page.goto("/settings/integrations");
    const creds = page.getByRole("form", { name: "Set channel credentials" });
    await creds.getByLabel("Channel").selectOption("slack");
    await creds.getByLabel("Secret").fill("https://example.com/not-slack");
    await creds.getByRole("button", { name: "Save secret" }).click();
    await expect(creds.getByRole("alert")).toContainText("https://hooks.slack.com/");

    const connect = page.getByRole("form", { name: "Connect a payment account" });
    await connect.getByLabel("Mode").selectOption("test");
    await connect.getByLabel("API key").fill("rk_live_not_for_a_test_account");
    await connect.getByRole("button", { name: "Connect" }).click();
    await expect(connect.getByRole("alert")).toContainText("Use a Stripe test key");
    expect((await db().query("select count(*)::int as n from public.payment_accounts where tenant_id = $1 and provider = 'stripe'", [DEMO_TENANT])).rows[0].n).toBe(0);
  });
});

test.describe("accountant: standard templates", () => {
  test.use({ storageState: authFile("accountant") });

  test("a missing standard template can be added back from the Templates page, without touching edited ones", async ({ page }) => {
    const firm = (await db().query("select * from public.templates where tenant_id = $1 and template_key = 'firm' and channel = 'email'", [DEMO_TENANT])).rows[0];
    await db().query("delete from public.templates where id = $1", [firm.id]);
    await db().query("update public.templates set body = body || ' (edited)' where tenant_id = $1 and template_key = 'friendly' and channel = 'email'", [DEMO_TENANT]);
    try {
      await page.goto("/settings/templates");
      const form = page.getByRole("form", { name: "Standard templates" });
      await expect(form).toContainText("firm");
      await form.getByRole("button", { name: "Add the standard email templates" }).click();
      // Success re-renders the page with nothing missing, so the offer disappears (an error would stay, as an alert).
      await expect(page.getByRole("form", { name: "Standard templates" })).toHaveCount(0);
      const back = (await db().query("select subject, body from public.templates where tenant_id = $1 and template_key = 'firm' and channel = 'email'", [DEMO_TENANT])).rows[0];
      expect(back).toEqual({ subject: firm.subject, body: firm.body });
      const friendly = (await db().query("select body from public.templates where tenant_id = $1 and template_key = 'friendly' and channel = 'email'", [DEMO_TENANT])).rows[0];
      expect(friendly.body).toContain("(edited)");
      await page.reload();
      await expect(page.locator('[data-template="firm:email"]')).toBeVisible();
    } finally {
      await db().query("update public.templates set body = replace(body, ' (edited)', '') where tenant_id = $1 and template_key = 'friendly' and channel = 'email'", [DEMO_TENANT]);
    }
  });
});

// WhatsApp templates must be approved by Meta, and nothing in the UI could add one (setup-flow review, round 1).
// An accountant adds it; it starts "pending" (enforced by migration 0024) until an owner confirms Meta approved it.
test.describe("WhatsApp template: add, then an owner approves", () => {
  test("accountant adds a template, it is pending; the owner marks it approved", async ({ browser }) => {
    await db().query("delete from public.templates where tenant_id = $1 and template_key = 'firm' and channel = 'whatsapp'", [DEMO_TENANT]);
    try {
      const acc = await browser.newContext({ storageState: authFile("accountant") });
      const page = await acc.newPage();
      await page.goto("/settings/templates");
      const form = page.getByRole("form", { name: "New WhatsApp template" });
      await form.getByLabel("Template key").fill("firm");
      await form.getByLabel("Tone").selectOption("firm");
      await form.getByLabel("Name at Meta").fill("invoice_firm_v1");
      await form.getByLabel("Language code at Meta").fill("en");
      await form.getByLabel(/Text/).fill("Hello {{customer_name}}, invoice {{invoice_number}} is still open. {{business_name}}");
      await form.getByRole("button", { name: "Add WhatsApp template" }).click();
      await expect(page.locator('[data-template="firm:whatsapp"]')).toBeVisible();
      const row = (await db().query("select provider_status, provider_template_name from public.templates where tenant_id = $1 and template_key = 'firm' and channel = 'whatsapp'", [DEMO_TENANT])).rows[0];
      expect(row).toEqual({ provider_status: "pending", provider_template_name: "invoice_firm_v1" });
      await expect(page.locator('[data-template="firm:whatsapp"]').getByRole("button", { name: "Meta approved this text" })).toHaveCount(0);
      await acc.close();

      const own = await browser.newContext({ storageState: authFile("owner") });
      const op = await own.newPage();
      await op.goto("/settings/templates");
      await op.locator('[data-template="firm:whatsapp"]').getByRole("button", { name: "Meta approved this text" }).click();
      await expect(op.locator('[data-template="firm:whatsapp"]').getByTestId("wa-status")).toContainText("approved");
      await own.close();
    } finally {
      await db().query("delete from public.templates where tenant_id = $1 and template_key = 'firm' and channel = 'whatsapp'", [DEMO_TENANT]);
    }
  });
});

test.describe("accountant: channel settings", () => {
  test.use({ storageState: authFile("accountant") });

  test("an accountant sees no channel settings forms", async ({ page }) => {
    await page.goto("/settings/integrations");
    await expect(page.getByRole("heading", { name: "Integrations" })).toBeVisible();
    await expect(page.getByRole("form", { name: "Email sender" })).toHaveCount(0);
    await expect(page.getByRole("form", { name: "WhatsApp number" })).toHaveCount(0);
  });
});
