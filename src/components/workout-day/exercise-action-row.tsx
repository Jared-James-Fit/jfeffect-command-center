import type { ReactNode } from "react";
import { StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardMenu } from "@/components/workout-day/card-menu";

/**
 * The How To · Note · More · Rest row on every workout exercise card.
 *
 * Round 40px targets, so the row fits one line at any phone width. Rarer
 * actions (undo / redo / reset, swap, cues, calculator, help, reorder) live in
 * More; the calculator is also one tap from Tools at the top of the workout. It is a size container: labels
 * drop before anything wraps.
 */
export function ExerciseActionRow({
  name,
  howTo,
  hasNote,
  onOpenNote,
  moreMenu,
  rest,
}: {
  name: string;
  howTo: ReactNode | null;
  hasNote: boolean;
  onOpenNote: () => void;
  /** The items for More (CardMenuItem / CardMenuSeparator: tools, undo / redo / reset, swap, cues, help, reorder):
   *  a bottom sheet on a phone, a dropdown elsewhere (card-menu.tsx). */
  moreMenu: ReactNode;
  rest: ReactNode | null;
}) {
  const round =
    "relative h-10 w-10 shrink-0 rounded-full border border-border bg-card p-0 text-muted-foreground @max-[20rem]:h-9 @max-[20rem]:w-9 [&_svg]:size-[18px]";
  return (
    <div className="@container mt-2.5 min-w-0" data-testid="exercise-action-row">
      <div className="flex min-w-0 items-center justify-start gap-1.5 @max-[20rem]:gap-1">
        {howTo}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={round}
          onClick={onOpenNote}
          aria-label={hasNote ? `Notes for ${name}` : `Add note for ${name}`}
        >
          <StickyNote className="h-4 w-4" />
          {hasNote && (
            <span aria-hidden className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary ring-2 ring-card" />
          )}
        </Button>
        <CardMenu name={name} buttonClassName={round}>{moreMenu}</CardMenu>
        {rest && <div className="ml-auto flex min-w-0 shrink-0 justify-end">{rest}</div>}
      </div>
    </div>
  );
}
