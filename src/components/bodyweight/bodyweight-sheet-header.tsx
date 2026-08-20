import { ArrowLeft, X } from "lucide-react";
import { SheetClose, SheetTitle } from "@/components/ui/sheet";

export function BodyweightSheetHeader({ title }: { title: string }) {
  return (
    <div
      className="flex shrink-0 items-center gap-2 border-b border-border bg-background px-4 pb-3 pr-3"
      style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
    >
      <SheetClose
        aria-label="Back"
        className="inline-flex h-11 min-w-11 items-center justify-center gap-1 rounded-lg px-2 text-sm font-semibold text-foreground transition-colors hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>Back</span>
      </SheetClose>
      <SheetTitle className="min-w-0 flex-1 truncate text-left text-lg font-semibold">
        {title}
      </SheetTitle>
      <SheetClose
        aria-label="Close"
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <X className="h-5 w-5" />
      </SheetClose>
    </div>
  );
}
