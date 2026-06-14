import { Card } from "@/components/ui/card";
import { Calendar as CalIcon } from "lucide-react";

export function CalendarEmptyState({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}) {
  return (
    <Card className="border border-dashed border-border bg-card p-10 text-center">
      <CalIcon className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
      <div className="text-sm font-semibold text-foreground">{title}</div>
      {hint && <div className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
}