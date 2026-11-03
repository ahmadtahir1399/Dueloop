import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/session";
import { ImportWizard } from "./import-wizard";

/** S16 Import wizard. */
export default async function ImportPage() {
  const { tenant } = await requirePermission("import.run");
  return (
    <div className="grid gap-6">
      <PageHeader title="Import invoices" description="Nothing is saved until you press Import. A file with errors is never half-imported." />
      <ImportWizard defaultCurrency={tenant.currency} />
    </div>
  );
}
