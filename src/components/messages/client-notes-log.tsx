import { useMemo, useState } from "react";
import { format } from "date-fns";
import { AlertTriangle, NotebookPen, StickyNote, X } from "lucide-react";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { NOTES_FILTERS, matchesNotesFilter, painLine, type NotesFilter, type WorkoutNoteEntry } from "@/lib/workout-notes";
import { useClientWorkoutNotes } from "@/lib/workout-notes.queries";
import { OpenWorkout } from "@/components/messages/open-client-workout";

/**
 * A client's notes log for the coach: every review note, pain report and
 * exercise note they've sent, newest first, by month, filterable (Pain first
 * thing to check before programming), each one opening its workout. The same
 * list sits in the client's profile (Training) and behind Notes in their chat.
 */
export function ClientNotesLog({ clientId, limit, onSeeAll }: { clientId: string; limit?: number; onSeeAll?: () => void }) {
  const { data, isLoading, isError, refetch } = useClientWorkoutNotes(clientId);
  const [filter, setFilter] = useState<NotesFilter>("all");
  const all = data ?? [];
  const shown = useMemo(() => all.filter((e) => matchesNotesFilter(e, filter)), [all, filter]);
  const cut = limit ? shown.slice(0, limit) : shown;
  const months = useMemo(() => byMonth(cut), [cut]);
  const counts = useMemo(() => Object.fromEntries(NOTES_FILTERS.map((f) => [f.key, all.filter((e) => matchesNotesFilter(e, f.key)).length])), [all]);

  return (
    <div className="space-y-3" data-client-notes-log>
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Show">
        {NOTES_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={cn("h-8 shrink-0 rounded-full px-3 text-[12px] font-bold transition-colors", filter === f.key ? "bg-foreground text-background" : "bg-muted text-muted-foreground active:bg-muted/70")}
          >
            {f.label}
            {counts[f.key] ? <span className="ml-1 opacity-70">{counts[f.key]}</span> : null}
          </button>
        ))}
      </div>
      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
        </div>
      ) : isError ? (
        <button type="button" onClick={() => void refetch()} className="w-full rounded-xl border border-border/70 p-4 text-center text-[13px] text-muted-foreground">
          Couldn't load notes. Tap to try again.
        </button>
      ) : cut.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground" data-client-notes-empty>
          {filter === "all" ? "No notes from their workouts yet." : filter === "pain" ? "No pain reported." : "Nothing here yet."}
        </p>
      ) : (
        months.map(([month, entries]) => (
          <section key={month}>
            <h4 className="mb-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-muted-foreground">{month}</h4>
            <ul className="space-y-2">
              {entries.map((e) => <NoteRow key={`${e.source}:${e.id}`} e={e} clientId={clientId} />)}
            </ul>
          </section>
        ))
      )}
      {limit && shown.length > limit && onSeeAll && (
        <button type="button" onClick={onSeeAll} className="h-10 w-full rounded-xl bg-muted text-[13px] font-bold active:bg-muted/70">
          See all {shown.length}
        </button>
      )}
    </div>
  );
}

function NoteRow({ e, clientId }: { e: WorkoutNoteEntry; clientId: string }) {
  const when = new Date(e.at);
  return (
    <li className={cn("rounded-xl border px-3 py-2.5", e.pain ? "border-red-500/30 bg-red-500/[0.05]" : "border-border/70 bg-card")} data-note-row={e.pain ? "pain" : e.source}>
      <div className="flex items-start gap-2.5">
        <span className={cn("mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full", e.pain ? "bg-red-500/15 text-red-600 dark:text-red-400" : "bg-muted text-muted-foreground")}>
          {e.pain ? <AlertTriangle className="h-3.5 w-3.5" /> : e.source === "exercise" ? <StickyNote className="h-3.5 w-3.5" /> : <NotebookPen className="h-3.5 w-3.5" />}
        </span>
        <div className="min-w-0 flex-1">
          {e.pain && <div className="text-[14px] font-black leading-snug">{painLine(e.pain)}</div>}
          {e.exercise && <div className="text-[13px] font-bold">{e.exercise}</div>}
          {e.note && <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-snug">“{e.note}”</p>}
          <div className="mt-1 text-[11px] leading-snug text-muted-foreground">
            {[format(when, "EEE, MMM d"), e.workout, e.edited_at ? "edited" : null, e.source === "review" && e.rpe ? `effort ${e.rpe}/10` : null].filter(Boolean).join(" · ")}
          </div>
          <OpenWorkout clientId={clientId} dayId={e.day_id} rowId={e.row_id} className="-ml-2.5 mt-0.5 h-7" />
        </div>
      </div>
    </li>
  );
}

function byMonth(entries: WorkoutNoteEntry[]): [string, WorkoutNoteEntry[]][] {
  const out = new Map<string, WorkoutNoteEntry[]>();
  for (const e of entries) {
    const m = format(new Date(e.at), "MMMM yyyy");
    const list = out.get(m) ?? [];
    list.push(e);
    out.set(m, list);
  }
  return [...out.entries()];
}

/** The whole log in a sheet (from the coach chat's Notes, or a card's "All notes"). */
export function ClientNotesSheet({ clientId, name, onClose }: { clientId: string | null; name?: string | null; onClose: () => void }) {
  return (
    <Sheet open={!!clientId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" hideCloseButton className="max-h-[90dvh] gap-0 overflow-y-auto rounded-t-[24px] p-0 sm:mx-auto sm:max-w-[560px]">
        <SheetHeader className="sticky top-0 z-10 flex-row items-center justify-between gap-3 space-y-0 border-b border-border/60 bg-background/95 px-5 pb-3 pt-4 text-left backdrop-blur">
          <div className="min-w-0">
            <SheetTitle className="text-[16px] font-black">{name ? `${name.split(" ")[0]}'s notes` : "Workout notes"}</SheetTitle>
            <SheetDescription className="text-[12px]">Pain, workout and exercise notes they've sent you</SheetDescription>
          </div>
          <SheetClose className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </SheetClose>
        </SheetHeader>
        <div className="px-4 pb-[max(env(safe-area-inset-bottom),20px)] pt-3">{clientId && <ClientNotesLog clientId={clientId} />}</div>
      </SheetContent>
    </Sheet>
  );
}

/** On the client's profile (Training): the latest few, the rest a tap away. */
export function ClientNotesCard({ clientId, name }: { clientId: string; name?: string | null }) {
  const [all, setAll] = useState(false);
  return (
    <div className="rounded-xl border border-border bg-card p-4 md:col-span-3" data-client-notes-card>
      <div className="mb-3">
        <div className="flex items-center gap-2">
          <NotebookPen className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold">Workout notes</h3>
        </div>
        <p className="mt-0.5 text-[11px] text-muted-foreground">Pain, review and exercise notes from {name?.split(" ")[0] ?? "the client"}. Each one also went to your Messages.</p>
      </div>
      <ClientNotesLog clientId={clientId} limit={6} onSeeAll={() => setAll(true)} />
      <ClientNotesSheet clientId={all ? clientId : null} name={name} onClose={() => setAll(false)} />
    </div>
  );
}
