import { Link } from "@tanstack/react-router";
import { Bookmark, BookmarkCheck, CalendarCheck, Loader2, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProgramFacets } from "@/lib/programs/facets";
import { facetChips } from "@/lib/programs/facets";

export interface ProgramCardProps {
  id: string;
  title: string;
  description?: string | null;
  facets: ProgramFacets;
  featured?: boolean;
  /** Top Picks: why it fits them, one quiet line. */
  reasons?: string[];
  /** Can't be started by this viewer. */
  disabled?: boolean;
  pending?: boolean;
  previewTo: { to: string; params?: Record<string, string> };
  onAdd?: () => void;
  addLabel?: string;
  /** Saved to My programs (shows Save / Saved). */
  saved?: boolean;
  onToggleSave?: () => void;
  /** It's the program on their calendar. */
  running?: boolean;
}

/**
 * A JF Effect plan in the library: the whole card opens it, and the row under
 * it saves it to My programs or starts it. No red here: a list of plans has
 * no one main action, the plan's own page does.
 */
export function ProgramCard({
  title,
  description,
  facets,
  featured,
  reasons,
  disabled,
  pending,
  previewTo,
  onAdd,
  addLabel = "Start plan",
  saved,
  onToggleSave,
  running,
}: ProgramCardProps) {
  const chips = facetChips(facets);
  return (
    <div
      className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card"
      data-plan-card
    >
      <Link
        to={previewTo.to as any}
        params={previewTo.params as any}
        className="block flex-1 p-4 transition active:bg-secondary/40"
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-2 min-w-0 break-words text-[16px] font-semibold leading-snug">
            {title}
          </h3>
          {running ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-foreground px-2 py-0.5 text-[11px] font-medium text-background">
              <CalendarCheck className="h-3 w-3" aria-hidden /> On your calendar
            </span>
          ) : featured ? (
            <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              Featured
            </span>
          ) : null}
        </div>
        {chips.length > 0 && (
          <div className="mt-1 text-[13px] text-muted-foreground">
            {chips.slice(0, 4).join(" · ")}
          </div>
        )}
        {reasons && reasons.length > 0 && (
          <p className="mt-2 line-clamp-2 text-[13px] text-foreground/80">
            Fits you: {reasons.join(" · ")}
          </p>
        )}
        {description && !reasons?.length && (
          <p className="mt-2 line-clamp-2 text-[13px] text-muted-foreground">{description}</p>
        )}
      </Link>
      {(onToggleSave || onAdd) && (
        <div className="flex border-t border-border">
          {onToggleSave && (
            <button
              type="button"
              onClick={onToggleSave}
              aria-pressed={!!saved}
              className="flex h-11 flex-1 items-center justify-center gap-1.5 text-[14px] font-medium text-muted-foreground transition hover:bg-secondary/40 active:bg-secondary/60"
            >
              {saved ? (
                <>
                  <BookmarkCheck className="h-4 w-4 text-foreground" aria-hidden /> Saved
                </>
              ) : (
                <>
                  <Bookmark className="h-4 w-4" aria-hidden /> Save
                </>
              )}
            </button>
          )}
          {onAdd && !running && (
            <button
              type="button"
              onClick={onAdd}
              disabled={disabled || pending}
              className={cn(
                "flex h-11 flex-1 items-center justify-center gap-1.5 text-[14px] font-semibold text-foreground transition hover:bg-secondary/40 active:bg-secondary/60 disabled:opacity-40",
                onToggleSave && "border-l border-border",
              )}
            >
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Play className="h-4 w-4" aria-hidden />
              )}
              {addLabel}
            </button>
          )}
          {running && (
            <Link
              to="/portal/workouts"
              className={cn(
                "flex h-11 flex-1 items-center justify-center gap-1.5 text-[14px] font-semibold text-foreground transition hover:bg-secondary/40",
                onToggleSave && "border-l border-border",
              )}
            >
              Open workouts
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
