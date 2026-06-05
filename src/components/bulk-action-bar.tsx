import { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

/**
 * Sticky bulk-action bar. Renders nothing when count is 0.
 * Drop into any list page; pass children as the action buttons.
 */
export function BulkActionBar({
  count,
  onClear,
  children,
  label = "selected",
}: {
  count: number;
  onClear: () => void;
  children: ReactNode;
  label?: string;
}) {
  if (count === 0) return null;
  return (
    <div className="sticky bottom-4 z-30 mx-auto w-fit max-w-full">
      <div className="flex flex-wrap items-center gap-2 rounded-full border border-border bg-card/95 px-3 py-2 shadow-lg backdrop-blur">
        <span className="text-xs font-semibold text-foreground px-1">
          {count} {label}
        </span>
        <div className="h-4 w-px bg-border" />
        <div className="flex flex-wrap items-center gap-1.5">{children}</div>
        <div className="h-4 w-px bg-border" />
        <Button size="sm" variant="ghost" onClick={onClear} className="h-7 px-2">
          <X className="h-3.5 w-3.5 mr-1" />
          Clear
        </Button>
      </div>
    </div>
  );
}