// UI-facing domain enums (redesign §5.2). The VALUES come from the core and authz packages; nothing is re-listed
// here, so a new status in core reaches the UI (and test/domain.test.ts keeps the types equal).
import { CHANNELS, INVOICE_STATUSES } from "@dueloop/core";
import { ROLES } from "@dueloop/authz";
import { z } from "zod";

export const InvoiceStatus = z.enum(INVOICE_STATUSES);
export type InvoiceStatus = z.infer<typeof InvoiceStatus>;

export const Channel = z.enum(CHANNELS);
export type Channel = z.infer<typeof Channel>;

/** Channels a business can actually use today (SMS exists in the schema but is not built). */
export const LiveChannel = Channel.extract(["email", "whatsapp"]);

export const Role = z.enum(ROLES);
export type Role = z.infer<typeof Role>;

/** Age buckets the invoice list filters on (lib/data/invoices reads the same list; issue R). */
export const LIST_BUCKETS = ["not_due", "1-30", "31-60", "61-90", "91+", "closed"] as const;

export const IsoDate = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Use a valid date." });
