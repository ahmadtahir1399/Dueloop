import { requirePermission } from "@/lib/session";
import { ImportWizard } from "./import-wizard";

export default async function ImportPage() {
  const { tenant } = await requirePermission("import.run");
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
