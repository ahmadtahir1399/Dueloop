import { Alert, AlertDescription } from "@/components/ui/alert";
import { canImport, requireTenant } from "@/lib/session";
import { ImportWizard } from "./import-wizard";

export default async function ImportPage() {
  const { role, tenant } = await requireTenant();
  if (!canImport(role)) {
    return (
      <Alert>
        <AlertDescription>Only owners and accountants can import invoices.</AlertDescription>
      </Alert>
    );
  }
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Import invoices</h1>
        <p className="text-sm text-muted-foreground">
          Nothing is saved until you press Import. A file with errors is never half-imported.
        </p>
      </div>
      <ImportWizard defaultCurrency={tenant.currency} />
    </div>
  );
}
