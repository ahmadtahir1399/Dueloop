import { isIanaZone } from "@dueloop/core";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/session";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  const { supabase, userId } = await requireUser();
  const { data } = await supabase.from("memberships").select("tenant_id").eq("user_id", userId).limit(1);
  if (data?.length) redirect("/");
  // The same rule the database trigger and core use, applied to the runtime's zone list.
  const zones = Intl.supportedValuesOf("timeZone").filter(isIanaZone);
  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Set up your business</CardTitle>
          <CardDescription>You will be its owner. You can invite your team later.</CardDescription>
        </CardHeader>
        <CardContent>
          <OnboardingForm zones={zones} defaultZone={zones.includes("Asia/Karachi") ? "Asia/Karachi" : (zones[0] ?? "UTC")} />
        </CardContent>
      </Card>
    </main>
  );
}
