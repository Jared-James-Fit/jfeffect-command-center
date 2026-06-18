import { useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

/**
 * Shared Quick Swap entry point used by every exercise row in
 * WorkoutDayView (both coaching clients and membership users).
 *
 * The button itself matches the visual weight of the surrounding
 * "How To" / "Notes" / "History" actions. Swap-target selection lives
 * inside the sheet so future logic (alternates, recent swaps, etc.)
 * can land in a single place without touching either row caller.
 */
export function QuickSwapButton({
  exerciseName,
}: {
  rowId: string;
  exerciseId: string | null;
  exerciseName: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        className="h-7 px-2 text-xs"
        aria-label={`Quick swap ${exerciseName}`}
      >
        <ArrowLeftRight className="mr-1 h-3 w-3" /> Swap
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[80vh]">
          <SheetHeader>
            <SheetTitle>Quick Swap</SheetTitle>
            <SheetDescription>
              Swap <span className="font-medium text-foreground">{exerciseName}</span> for an alternate.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
            Alternate selection is coming next. This button is wired into the
            shared row so client and member views stay in sync.
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

export default QuickSwapButton;