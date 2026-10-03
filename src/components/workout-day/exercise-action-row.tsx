import type { ReactNode } from "react";
import { GripVertical, MoreHorizontal, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/**
 * The How To · Note · More · Reorder · Rest row on every workout exercise card.
 *
 * It is a size container: controls shed secondary labels as the card gets
 * narrower (Note → icon, Rest chip → "▶ 1:00") instead of overflowing, so the
 * row always fits inside the card at any phone width. Nothing scrolls, wraps
 * or clips.
 */
export function ExerciseActionRow({
  name,
  howTo,
  hasNote,
  onOpenNote,
  moreMenu,
  reorderMenu,
  rest,
}: {
  name: string;
  howTo: ReactNode | null;
  hasNote: boolean;
  onOpenNote: () => void;
  /** DropdownMenuContent for "More". */
  moreMenu: ReactNode;
  /** DropdownMenuContent for reordering, or null when reordering isn't available. */
  reorderMenu: ReactNode | null;
  rest: ReactNode | null;
}) {
  return (
    <div className="@container mt-2 min-w-0" data-testid="exercise-action-row">
      <div className="flex min-w-0 flex-wrap items-center justify-start gap-1 gap-y-1.5 @max-[20rem]:gap-x-0.5">
        {howTo}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-10 min-w-10 shrink-0 gap-1.5 rounded-full px-2.5 text-xs font-medium text-muted-foreground @max-[20rem]:h-9 @max-[20rem]:min-w-9 @max-[20rem]:px-2"
          onClick={onOpenNote}
          aria-label={hasNote ? `Notes for ${name}` : `Add note for ${name}`}
        >
          <StickyNote className="h-3.5 w-3.5" />
          <span className="hidden @[22.5rem]:inline">{hasNote ? "Notes" : "Note"}</span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-10 w-10 shrink-0 rounded-full border border-border bg-card p-0 text-muted-foreground @max-[20rem]:h-9 @max-[20rem]:w-9 [&_svg]:size-[18px]"
              aria-label={`More options for ${name}`}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          {moreMenu}
        </DropdownMenu>
        {reorderMenu && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                data-no-swipe
                className="h-10 w-10 shrink-0 rounded-full border border-border bg-card p-0 text-muted-foreground @max-[20rem]:h-9 @max-[20rem]:w-9 [&_svg]:size-[18px]"
                aria-label={`Reorder ${name}`}
              >
                <GripVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            {reorderMenu}
          </DropdownMenu>
        )}
        {rest && <div className="ml-auto flex min-w-0 shrink-0 justify-end">{rest}</div>}
      </div>
    </div>
  );
}
