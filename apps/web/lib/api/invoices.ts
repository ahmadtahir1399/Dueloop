// POST /v1/invoices request handling (pure parts, testable without a server). The JSON batch becomes the same
// CSV the import wizard would see (explicit options, integer minor units shown as major text by core, ISO dates
// with dateFormat YMD), so validation and commit are IDENTICAL to the CSV import (parity by construction).
import { digitsToMajorString } from "@dueloop/core";
import { z } from "zod";

export const API_MAX_BODY_BYTES = 1024 * 1024;
export const API_MAX_INVOICES = 500;

const invoice = z
  .object({
    number: z.string().min(1).max(100),
    customer: z
      .object({
        name: z.string().min(1).max(200),
        email: z.string().max(254).optional(),
        phone: z.string().max(40).optional(),
        external_id: z.string().max(100).optional(),
      })
      .strict(),
    amount_minor: z.union([z.string().regex(/^[1-9][0-9]{0,17}$/), z.number().int().positive().max(Number.MAX_SAFE_INTEGER)]),
    currency: z.string().regex(/^[A-Z]{3}$/),
    issued_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    due_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();

export const requestSchema = z
  .object({
    options: z
      .object({
        default_country: z.string().regex(/^[A-Z]{2}$/),
        skip_invalid: z.boolean().default(false),
      })
      .strict(),
    invoices: z.array(invoice).min(1).max(API_MAX_INVOICES),
  })
  .strict();

export type ApiRequest = z.infer<typeof requestSchema>;

export const HEADER = ["invoice_no", "customer", "email", "phone", "amount", "currency", "issued", "due", "customer_id"] as const;

export const API_MAPPING = {
  invoiceNumber: "invoice_no",
  customerName: "customer",
  email: "email",
  phone: "phone",
  total: "amount",
  currency: "currency",
  issuedOn: "issued",
  dueOn: "due",
  externalCustomerId: "customer_id",
} as const;

/**
 * The batch as CSV text, every cell quoted per RFC 4180. Values are NOT formula-neutralised here: this is input, and
 * it must equal what the same data uploaded as a CSV file would contain (exports neutralise on the way out).
 */
export function toCsv(req: ApiRequest): { ok: true; csv: string } | { ok: false; index: number; message: string } {
  const lines = [HEADER.join(",")];
  for (const [index, inv] of req.invoices.entries()) {
    const major = digitsToMajorString(String(inv.amount_minor), inv.currency);
    if (!major.ok) return { ok: false, index, message: major.error === "unknown_currency" ? "unknown currency" : "amount_minor must be a positive integer" };
    const cells = [inv.number, inv.customer.name, inv.customer.email ?? "", inv.customer.phone ?? "", major.value, inv.currency, inv.issued_on, inv.due_on, inv.customer.external_id ?? ""];
    lines.push(cells.map((c) => `"${c.replace(/"/g, '""')}"`).join(","));
  }
  return { ok: true, csv: `${lines.join("\r\n")}\r\n` };
}

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}
export const apiError = (code: string, message: string, details?: unknown): ApiError => ({ error: { code, message, ...(details === undefined ? {} : { details }) } });
