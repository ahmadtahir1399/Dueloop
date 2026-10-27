import { Badge } from "@/components/ui/badge";

const VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  open: "outline",
  overdue: "destructive",
  promised: "secondary",
  disputed: "destructive",
  escalated: "destructive",
  paid: "default",
  written_off: "secondary",
  cancelled: "secondary",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge variant={VARIANT[status] ?? "outline"}>{status.replace("_", " ")}</Badge>;
}
