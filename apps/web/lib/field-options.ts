// Option lists for the searchable fields (§7.2 Combobox), built on the server from the runtime's ICU data, so the
// browser receives a plain list and server and client never disagree. Values are what the forms already posted:
// an IANA zone name, a 3-letter currency code.
import { isIanaZone } from "@dueloop/core";
import type { Choice } from "@/components/ui/choice-select";

/** IANA zones the database trigger and core accept. `keep` stays in the list even if the runtime lacks it. */
export function zoneOptions(keep?: string): Choice[] {
  const zones = Intl.supportedValuesOf("timeZone").filter(isIanaZone);
  if (keep && !zones.includes(keep)) zones.unshift(keep);
  return zones.map((z) => ({ value: z, label: z }));
}

/** ISO 4217 codes with English names, e.g. "PKR — Pakistani Rupee". */
export function currencyOptions(): Choice[] {
  const names = new Intl.DisplayNames(["en"], { type: "currency" });
  return Intl.supportedValuesOf("currency").map((c) => {
    const name = names.of(c);
    return { value: c, label: name && name !== c ? `${c} — ${name}` : c };
  });
}
