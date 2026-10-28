"use client";

import { useActionState, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createBusiness, type OnboardingState } from "./actions";

const HOURS = Array.from({ length: 24 }, (_, h) => String(h));

export function OnboardingForm({ zones, defaultZone }: { zones: string[]; defaultZone: string }) {
  const [state, action, pending] = useActionState<OnboardingState, FormData>(createBusiness, {});
  const [timezone, setTimezone] = useState(defaultZone);
  const [quietStart, setQuietStart] = useState("20");
  const [quietEnd, setQuietEnd] = useState("9");
  return (
    <form action={action} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="name">Business name</Label>
        <Input id="name" name="name" required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="timezone">Time zone</Label>
        <input type="hidden" name="timezone" value={timezone} />
        <Select value={timezone} onValueChange={setTimezone}>
          <SelectTrigger id="timezone" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {zones.map((z) => (
              <SelectItem key={z} value={z}>
                {z}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="currency">Main currency</Label>
        <Input id="currency" name="currency" placeholder="PKR" maxLength={3} required className="uppercase" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        {(
          [
            ["quietStart", "No messages from", quietStart, setQuietStart],
            ["quietEnd", "until", quietEnd, setQuietEnd],
          ] as const
        ).map(([name, label, value, set]) => (
          <div key={name} className="grid gap-2">
            <Label htmlFor={name}>{label}</Label>
            <input type="hidden" name={name} value={value} />
            <Select value={value} onValueChange={set}>
              <SelectTrigger id={name} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {HOURS.map((h) => (
                  <SelectItem key={h} value={h}>
                    {h.padStart(2, "0")}:00
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        Quiet hours are in the business&apos;s local time. Choose the same hour twice for no quiet hours.
      </p>
      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create business"}
      </Button>
    </form>
  );
}
