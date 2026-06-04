import { Badge } from "@/components/ui/badge";
import { STATUS_BADGE } from "@/lib/agreements";
import { cn } from "@/lib/utils";

export function AgreementStatusBadge({ status, className }: { status: string; className?: string }) {
  const cls = STATUS_BADGE[status] ?? "bg-muted text-muted-foreground";
  return <Badge variant="secondary" className={cn(cls, "border-0", className)}>{status}</Badge>;
}