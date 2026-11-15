import type { ReactNode } from "react";
import { NotebookPen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardMenu } from "@/components/workout-day/card-menu";

/**
 * The line under a card's prescription and references, over its sets:
 * "Rest 5 min" on the left (the countdown while it runs), then How To · Note ·
 * the rest timer · More as quiet icons on the right, after a hairline.
 *
 * 40px round targets with no outline, so the row is one line at any phone
 * width. Rarer actions (undo / redo / reset, swap, cues, tools, help, reorder)
 * live in More (card-menu.tsx: a bottom sheet on a phone).
 */
export function ExerciseActionRow({
  name,
  howTo,
  hasNote,
  onOpenNote,
  moreMenu,
  rest,
  restLabel = null,
}: {
  name: string;
  howTo: ReactNode | null;
  hasNote: boolean;
  onOpenNote: () => void;
  /** The items for More (CardMenuItem / CardMenuSeparator: tools, undo / redo / reset, swap, cues, help, reorder):
   *  a bottom sheet on a phone, a dropdown elsewhere (card-menu.tsx). */
  moreMenu: ReactNode;
  /** The rest timer's icon (RestTimer's `button`). */
  rest: ReactNode | null;
  /** "Rest 5 min", or the countdown while it runs (RestTimer's `label`). */
  restLabel?: ReactNode | null;
}) {
  const round =
    "relative h-10 w-10 shrink-0 rounded-full p-0 text-muted-foreground hover:bg-muted hover:text-foreground [&_svg]:size-[22px]";
  return (
    <div className="@container mt-3 min-w-0 border-t border-border/60 pt-1.5" data-testid="exercise-action-row">
      <div className="flex min-w-0 items-center gap-0.5">
        <div className="flex min-w-0 flex-1 items-center">{restLabel}</div>
        {howTo}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={round}
          onClick={onOpenNote}
          aria-label={hasNote ? `Notes for ${name}` : `Add note for ${name}`}
        >
          <NotebookPen />
          {hasNote && (
            <span aria-hidden className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-foreground ring-2 ring-card" />
          )}
        </Button>
        {rest}
        <CardMenu name={name} buttonClassName={round}>{moreMenu}</CardMenu>
      </div>
    </div>
  );
}
