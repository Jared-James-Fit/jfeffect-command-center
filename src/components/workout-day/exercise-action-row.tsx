import type { ReactNode } from "react";
import { NotebookPen } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The card's quiet icons, at the end of its rest line right above the set
 * table: How To (the demo) and Note (a dot when there's one). The rest of the
 * card's actions (swap, history, setup, tools, move, remove…) are its ⋯, top
 * right beside the name; the rest timer is the line itself (RestLine).
 */
export function ExerciseQuickActions({
  name,
  howTo,
  hasNote,
  onOpenNote,
}: {
  name: string;
  howTo: ReactNode;
  hasNote: boolean;
  onOpenNote: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5" data-exercise-quick-actions>
      {howTo}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="relative h-10 w-10 shrink-0 rounded-full p-0 text-muted-foreground hover:bg-muted hover:text-foreground [&_svg]:size-[22px]"
        onClick={onOpenNote}
        aria-label={hasNote ? `Notes for ${name}` : `Add note for ${name}`}
        title={hasNote ? "Notes" : "Add a note"}
      >
        <NotebookPen />
        {hasNote && <span aria-hidden className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-foreground ring-2 ring-card" />}
      </Button>
    </div>
  );
}
