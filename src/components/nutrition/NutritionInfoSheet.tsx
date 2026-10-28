import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

/**
 * A quick read that opens from a tap on the client's Nutrition page (food-
 * weighing rules, the nutrition disclaimer): a bottom sheet with the sheet's
 * own Back pill at the top and Done at the bottom, in reach of a thumb.
 */
export function NutritionInfoSheet({
  open,
  onOpenChange,
  title,
  icon: Icon,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-3xl p-0">
        <div className="mx-auto max-w-lg px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3">
          {/* the app's sheet header: the title beside the sheet's own Back pill */}
          <SheetHeader className="space-y-0">
            <SheetTitle className="flex items-center gap-2 text-lg font-black">
              <Icon className="h-5 w-5 text-primary" aria-hidden />
              {title}
            </SheetTitle>
          </SheetHeader>
          <div className="mt-4 text-[15px] leading-relaxed text-foreground/90">{children}</div>
          <SheetClose asChild>
            <Button className="mt-6 h-12 w-full text-base font-semibold" variant="secondary">
              Done
            </Button>
          </SheetClose>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** A coach's multi-line rules as a list: one rule per line, blank lines dropped. */
export function RulesList({ text }: { text: string }) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[-*•·]\s*/, "").trim())
    .filter(Boolean);
  return (
    <ul className="space-y-3">
      {lines.map((l, i) => (
        <li key={i} className="flex gap-3">
          <span aria-hidden className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
          <span>{l}</span>
        </li>
      ))}
    </ul>
  );
}
