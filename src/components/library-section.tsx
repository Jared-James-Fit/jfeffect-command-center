import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Props = {
  label: string;
  description?: string;
  count: number;
  defaultOpen?: boolean;
  children: ReactNode;
};

export function LibrarySection({ label, description, count, defaultOpen = false, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const disabled = count === 0;
  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={disabled}
        aria-expanded={open}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{label}</span>
            <Badge variant="secondary" className="text-[10px]">{count}</Badge>
          </div>
          {description && (
            <div className="mt-0.5 truncate text-xs text-muted-foreground">{description}</div>
          )}
        </div>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && !disabled && (
        <div className="border-t bg-background/40 p-4">{children}</div>
      )}
    </Card>
  );
}