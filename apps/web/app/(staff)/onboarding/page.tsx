import { redirect } from "next/navigation";
import { Wordmark } from "@/components/ui/wordmark";
import { currencyOptions, zoneOptions } from "@/lib/field-options";
import { requireUser } from "@/lib/session";
import { OnboardingForm } from "./onboarding-form";

/** S04 Onboarding. */
export default async function OnboardingPage() {
  const { supabase, userId } = await requireUser();
  const { data } = await supabase.from("memberships").select("tenant_id").eq("user_id", userId).limit(1);
  if (data?.length) redirect("/overview");
  // The same rule the database trigger and core use, applied to the runtime's zone list.
  const zones = zoneOptions().map((o) => o.value);
  return (
    <div className="grid min-h-svh content-start gap-10 gutter py-8">
      <Wordmark />
      <main id="main" className="mx-auto grid w-full max-w-xl gap-6">
        <div className="grid gap-1">
          <h1 className="t-display-lg">Set up your business</h1>
          <p className="t-body-md text-ink-muted">You will be its owner. You can invite your team later.</p>
        </div>
        <div className="card-edge rounded-2xl border border-line bg-panel p-6">
          <OnboardingForm zones={zones} currencies={currencyOptions()} defaultZone={zones.includes("Asia/Karachi") ? "Asia/Karachi" : (zones[0] ?? "UTC")} />
        </div>
      </main>
    </div>
  );
}
