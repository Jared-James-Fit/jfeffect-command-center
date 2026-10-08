import type { ReactNode } from "react";
import { MoreHorizontal, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/**
 * The How To · Note · More · Rest row on every workout exercise card.
 *
 * Four controls, all 40px round targets, so the row fits one line at any phone
 * width. Rarer actions (cues, swap, reorder) live in More. It is a size
 * container: labels drop before anything wraps.
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
  /** DropdownMenuContent for "More" (cues, help, swap, reorder). */
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="sm" variant="ghost" data-no-swipe className={round} aria-label={`More options for ${name}`}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          {moreMenu}
        </DropdownMenu>
        {rest && <div className="ml-auto flex min-w-0 shrink-0 justify-end">{rest}</div>}
      </div>
    </div>
  );
}
