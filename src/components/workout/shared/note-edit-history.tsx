import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  NOTE_HISTORY_SINCE,
  earlierVersions,
  editedLabel,
  noteMoment,
  originalNotKept,
  type NoteDates,
  type NoteRevision,
} from "@/lib/exercise-note-versions";

const sb = supabase as any;

/** Every earlier wording of one note, read only when someone opens it (RLS: the athlete, their coach, admins). */
export function useNoteRevisions(noteId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["exercise-note-revisions", noteId ?? null],
    enabled: enabled && !!noteId,
    staleTime: 30_000,
    queryFn: async (): Promise<NoteRevision[]> => {
      const { data, error } = await sb
        .from("pl_exercise_note_revisions")
        .select("id, content, written_at, replaced_at")
        .eq("note_id", noteId)
        .order("written_at", { ascending: true })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as NoteRevision[];
    },
  });
}

/**
 * "Edited Nov 19 ⌄": the subtle mark an edited note carries, and the way into
 * its earlier versions. Nothing when the note was never edited.
 */
export function EditedToggle({
  note, open, onToggle, className,
}: { note: NoteDates | null | undefined; open: boolean; onToggle: () => void; className?: string }) {
  const label = editedLabel(note);
  if (!label) return null;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      aria-expanded={open}
      data-note-edited
      className={cn("inline-flex items-center gap-0.5 rounded text-[11px] text-muted-foreground underline-offset-2 hover:underline active:opacity-60", className)}
    >
      {label}
      <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} aria-hidden />
    </button>
  );
}

/**
 * A note's earlier versions, oldest first (the original marked), shown only
 * while open. `onRestore` offers "Use this" on each, which hands the words
 * back to the editor (nothing is saved until they save).
 */
export function NoteVersions({
  noteId, note, open, onRestore, className,
}: {
  noteId: string | null | undefined;
  note: NoteDates;
  open: boolean;
  onRestore?: (content: string) => void;
  className?: string;
}) {
  const { data, isLoading, isError, refetch } = useNoteRevisions(noteId, open);
  if (!open) return null;
  const versions = earlierVersions(note, data);
  const gap = !isLoading && !isError && originalNotKept(note, versions);
  return (
    <div className={cn("space-y-2.5 border-l-2 border-border pl-3", className)} data-note-versions>
      {isLoading ? (
        <div className="space-y-1.5" aria-busy="true" aria-label="Loading earlier versions">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-4 w-full" />
        </div>
      ) : isError ? (
        <button type="button" onClick={() => void refetch()} className="text-[12px] text-muted-foreground underline underline-offset-2">
          Couldn't load earlier versions. Tap to try again.
        </button>
      ) : (
        <>
          {versions.map((v) => (
            <div key={v.id} data-note-version={v.original ? "original" : "edit"}>
              <div className="flex items-baseline gap-2 text-[11px] text-muted-foreground">
                <span>
                  {v.original ? <span className="font-semibold text-foreground">Original · </span> : null}
                  {noteMoment(v.at)}
                </span>
                {onRestore && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onRestore(v.content); }}
                    className="ml-auto -my-2 inline-flex h-8 shrink-0 items-center rounded-full px-2.5 font-semibold text-foreground active:bg-muted"
                    data-note-version-use
                  >
                    Use this
                  </button>
                )}
              </div>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-snug text-muted-foreground">{v.content}</p>
            </div>
          ))}
          {gap && (
            <p className="text-[11px] text-muted-foreground" data-note-version-gap>
              {versions.length ? "Older wording" : "The earlier wording"} from before {NOTE_HISTORY_SINCE} wasn't kept.
            </p>
          )}
        </>
      )}
    </div>
  );
}
