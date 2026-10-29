"use client";

import type { DateFormat, Mapping } from "@dueloop/ingest";
import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMinor } from "@/lib/money";
import { commitBatch, errorReport, previewImport, readColumns, type CommitResultView, type PreviewResult } from "./actions";

type Field = "invoiceNumber" | "customerName" | "total" | "issuedOn" | "dueOn" | "email" | "phone" | "currency" | "externalCustomerId" | "status";

const FIELDS: { key: Field; label: string; required: boolean; hint: RegExp }[] = [
  { key: "invoiceNumber", label: "Invoice number", required: true, hint: /invoice[\s_-]*(no|nr|num|number|#)|^#|rechnungs?nr|^number$|^invoice$/i },
  { key: "customerName", label: "Customer name", required: true, hint: /customer|client|bill\s*to|kunde|^name$/i },
  { key: "total", label: "Amount", required: true, hint: /amount|total|betrag|sum/i },
  { key: "issuedOn", label: "Issue date", required: true, hint: /issue|invoice\s*date|rechnungsdatum|^date$/i },
  { key: "dueOn", label: "Due date", required: true, hint: /due|f(ä|ae)llig/i },
  { key: "email", label: "Email", required: false, hint: /mail/i },
  { key: "phone", label: "Phone", required: false, hint: /phone|tel|mobile|whatsapp/i },
  { key: "currency", label: "Currency", required: false, hint: /currency|w(ä|ae)hrung|^ccy$/i },
  { key: "externalCustomerId", label: "Customer ID", required: false, hint: /customer.?id|client.?id|account/i },
  { key: "status", label: "Status (to skip paid/void rows)", required: false, hint: /status/i },
];

const NONE = "__none__";

/** Pre-selects a likely column for each field; the user always confirms or changes it. */
function suggest(header: string[]): Record<Field, string> {
  const used = new Set<string>();
  const out = {} as Record<Field, string>;
  for (const f of FIELDS) {
    const hit = header.find((h) => !used.has(h) && f.hint.test(h));
    out[f.key] = hit ?? NONE;
    if (hit) used.add(hit);
  }
  return out;
}

function Choice({ label, value, onChange, options, placeholder }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder?: string }) {
  const id = useId();
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function ImportWizard({ defaultCurrency }: { defaultCurrency: string }) {
  const [pending, startTransition] = useTransition();
  const [file, setFile] = useState<File | null>(null);
  const [header, setHeader] = useState<string[] | null>(null);
  const [mapping, setMapping] = useState<Record<Field, string> | null>(null);
  const [skipValues, setSkipValues] = useState("Paid, Void");
  const [dateFormat, setDateFormat] = useState<DateFormat | "">("");
  const [decimal, setDecimal] = useState<"." | ",">(".");
  const [delimiter, setDelimiter] = useState("auto");
  const [country, setCountry] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [committed, setCommitted] = useState<CommitResultView | null>(null);
  const [skipInvalid, setSkipInvalid] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function buildForm(): FormData | null {
    if (!file || !mapping) return null;
    const m: Record<string, unknown> = {};
    for (const f of FIELDS) {
      const col = mapping[f.key];
      if (col === NONE) continue;
      m[f.key] = f.key === "status" ? { column: col, skipValues: skipValues.split(",").map((s) => s.trim()).filter(Boolean) } : col;
    }
    const fd = new FormData();
    fd.set("file", file);
    fd.set("mapping", JSON.stringify(m satisfies Partial<Record<keyof Mapping, unknown>>));
    fd.set(
      "options",
      JSON.stringify({ delimiter, decimal, dateFormat, defaultCountry: country.trim().toUpperCase(), defaultCurrency: currency.trim().toUpperCase(), timezone: "tenant" }),
    );
    return fd;
  }

  function onFile(f: File | null) {
    setFile(f);
    setHeader(null);
    setMapping(null);
    setPreview(null);
    setCommitted(null);
    setError(null);
    if (!f) return;
    const fd = new FormData();
    fd.set("file", f);
    startTransition(async () => {
      const r = await readColumns(fd);
      if (!r.ok) return setError(r.error);
      setHeader(r.header);
      setMapping(suggest(r.header));
    });
  }

  function onPreview() {
    setError(null);
    setCommitted(null);
    if (!dateFormat) return setError("Choose the date format used in the file. It is never guessed.");
    const fd = buildForm();
    if (!fd) return;
    startTransition(async () => {
      const r = await previewImport(fd);
      setPreview(r);
      setSkipInvalid(false);
      if (!r.ok) setError(r.error);
    });
  }

  function onCommit() {
    if (!preview?.ok) return;
    startTransition(async () => {
      const r = await commitBatch(preview.batchId, skipInvalid);
      setCommitted(r);
      if (r.ok) {
        toast.success(`Imported: ${r.counts.invoices.created} new, ${r.counts.invoices.updated} updated invoices.`);
      } else {
        setError(r.error);
      }
    });
  }

  function onReport() {
    const fd = buildForm();
    if (!fd) return;
    startTransition(async () => {
      const r = await errorReport(fd);
      if (!r.ok) return setError(r.error);
      const url = URL.createObjectURL(new Blob([r.csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${file?.name.replace(/\.csv$/i, "") ?? "import"}-report.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  const columnOptions = [{ value: NONE, label: "— not in this file —" }, ...(header ?? []).map((h) => ({ value: h, label: h }))];
  const missingRequired = mapping ? FIELDS.filter((f) => f.required && mapping[f.key] === NONE) : [];

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>1. Choose a CSV file</CardTitle>
          <CardDescription>UTF-8 CSV, up to 5 MB and 10,000 rows. Re-importing the same file changes nothing.</CardDescription>
        </CardHeader>
        <CardContent>
          <Input type="file" aria-label="CSV file to import" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0] ?? null)} disabled={pending} />
        </CardContent>
      </Card>

      {header && mapping ? (
        <Card>
          <CardHeader>
            <CardTitle>2. Match the columns and options</CardTitle>
            <CardDescription>Suggestions are pre-selected; check each one.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FIELDS.map((f) => (
                <Choice
                  key={f.key}
                  label={`${f.label}${f.required ? " *" : ""}`}
                  value={mapping[f.key]}
                  onChange={(v) => setMapping({ ...mapping, [f.key]: v })}
                  options={columnOptions}
                />
              ))}
              {mapping.status !== NONE ? (
                <div className="grid gap-2">
                  <Label htmlFor="skip">Skip rows whose status is</Label>
                  <Input id="skip" value={skipValues} onChange={(e) => setSkipValues(e.target.value)} />
                </div>
              ) : null}
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <Choice
                label="Date format *"
                value={dateFormat}
                onChange={(v) => setDateFormat(v as DateFormat)}
                placeholder="Choose…"
                options={[
                  { value: "DMY", label: "DMY (31/12/2026)" },
                  { value: "MDY", label: "MDY (12/31/2026)" },
                  { value: "YMD", label: "YMD (2026-12-31)" },
                ]}
              />
              <Choice
                label="Decimal separator"
                value={decimal}
                onChange={(v) => setDecimal(v as "." | ",")}
                options={[
                  { value: ".", label: "Point (1,250.00)" },
                  { value: ",", label: "Comma (1.250,00)" },
                ]}
              />
              <Choice
                label="Delimiter"
                value={delimiter}
                onChange={setDelimiter}
                options={[
                  { value: "auto", label: "Detect" },
                  { value: ",", label: "Comma" },
                  { value: ";", label: "Semicolon" },
                  { value: "\t", label: "Tab" },
                  { value: "|", label: "Pipe" },
                ]}
              />
              <div className="grid gap-2">
                <Label htmlFor="country">Phone country *</Label>
                <Input id="country" placeholder="PK" maxLength={2} value={country} onChange={(e) => setCountry(e.target.value)} className="uppercase" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="currency">Default currency</Label>
                <Input id="currency" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value)} className="uppercase" />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={onPreview} disabled={pending || missingRequired.length > 0 || !country.trim()}>
                {pending ? "Working…" : "Preview import (dry run)"}
              </Button>
              {missingRequired.length > 0 ? (
                <span className="text-sm text-muted-foreground">Map: {missingRequired.map((f) => f.label).join(", ")}</span>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Import problem</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {preview?.ok ? (
        <Card>
          <CardHeader>
            <CardTitle>3. Preview</CardTitle>
            <CardDescription>
              {preview.rows} rows · {preview.importable} importable · {preview.invalid} with errors · {preview.skipped} skipped · delimiter{" "}
              {JSON.stringify(preview.delimiter)}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {preview.fileWarnings.map((w) => (
              <Alert key={w}>
                <AlertDescription>{w}</AlertDescription>
              </Alert>
            ))}
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <span className="font-medium">Invoices: </span>
                {preview.counts.invoices.created} new · {preview.counts.invoices.updated} updated · {preview.counts.invoices.unchanged} unchanged ·{" "}
                {preview.counts.invoices.skipped} skipped
              </div>
              <div>
                <span className="font-medium">Customers: </span>
                {preview.counts.customers.created} new · {preview.counts.customers.updated} updated · {preview.counts.customers.unchanged} unchanged
              </div>
            </div>
            {preview.ambiguousDates ? (
              <Alert variant="destructive" data-testid="ambiguous-dates">
                <AlertTitle>Check the date format</AlertTitle>
                <AlertDescription>
                  No date in this file proves the format you chose: every day is 12 or less, so 03/04 could be 3 April or 4 March. Compare the
                  dates below with your accounting tool before importing.
                </AlertDescription>
              </Alert>
            ) : null}
            {preview.sample.length > 0 ? (
              <div className="overflow-x-auto">
                <Table aria-label="First rows as they will be imported" data-testid="import-sample">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Line</TableHead>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Issued</TableHead>
                      <TableHead>Due</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.sample.map((r) => (
                      <TableRow key={r.line}>
                        <TableCell className="tabular-nums">{r.line}</TableCell>
                        <TableCell dir="auto">{r.number}</TableCell>
                        <TableCell dir="auto">{r.customer}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatMinor(r.amount, r.currency)}</TableCell>
                        <TableCell>{r.issuedOn}</TableCell>
                        <TableCell>{r.dueOn}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : null}
            {preview.issues.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">Line</TableHead>
                      <TableHead>Problems</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.issues.map((i) => (
                      <TableRow key={i.line}>
                        <TableCell className="tabular-nums">{i.line}</TableCell>
                        <TableCell className="grid gap-1 whitespace-normal">
                          {i.errors.map((e) => (
                            <span key={e}>
                              <Badge variant="destructive" className="mr-2">
                                error
                              </Badge>
                              {e}
                            </span>
                          ))}
                          {i.warnings.map((w) => (
                            <span key={w} className="text-muted-foreground">
                              <Badge variant="outline" className="mr-2">
                                warning
                              </Badge>
                              {w}
                            </span>
                          ))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              {preview.invalid > 0 ? (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={skipInvalid} onChange={(e) => setSkipInvalid(e.target.checked)} />
                  Skip the {preview.invalid} rows with errors and import the rest
                </label>
              ) : null}
              <Button onClick={onCommit} disabled={pending || (preview.invalid > 0 && !skipInvalid) || committed?.ok === true}>
                {committed?.ok ? "Imported" : "Import"}
              </Button>
              <Button variant="outline" onClick={onReport} disabled={pending}>
                Download error report
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {committed?.ok ? (
        <Alert>
          <AlertTitle>Import complete</AlertTitle>
          <AlertDescription>
            {committed.counts.invoices.created} invoices created, {committed.counts.invoices.updated} updated, {committed.counts.invoices.unchanged} unchanged.{" "}
            <Link className="underline" href="/invoices">
              View invoices
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
