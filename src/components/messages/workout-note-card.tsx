import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { AlertTriangle, ArrowDown, ChevronRight, NotebookPen, StickyNote } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { painLine, type WorkoutNoteCardAttachment, type WorkoutNotePain } from "@/lib/workout-notes";
import { ClientNotesSheet } from "@/components/messages/client-notes-log";
import { OpenWorkout } from "@/components/messages/open-client-workout";

const sb = supabase as any;

type Live = { note: string | null; pain: WorkoutNotePain | null; edited: boolean; latestMessageId: string | null; exercise: string | null } | null;

/**
 * A note the athlete sent from a workout, in the coach chat: pain first (it's
 * what the coach must not miss), then what they wrote, the workout and when.
 * It reads the note as it is now, so an edit shows here; a later card for the
 * same note takes over ("Updated below"). The coach can open that workout or
 * the client's whole notes log; the athlete sees it went to their coach.
 */
export function WorkoutNoteCard({ att, messageId, role, clientId }: {
  att: WorkoutNoteCardAttachment;
  messageId: string;
  role: "admin" | "client";
  clientId: string;
}) {
  const staff = role === "admin";
  const [log, setLog] = useState(false);
  const source = att.source === "exercise" ? "exercise" : "review";
  const sourceId = source === "exercise" ? att.note_id : att.feedback_id;
  const { data: live } = useQuery({
    queryKey: ["workout-note-card", source, sourceId ?? null],
    enabled: !!sourceId,
    staleTime: 30_000,
    queryFn: async (): Promise<Live> => {
      if (source === "exercise") {
        const { data } = await sb.from("pl_exercise_notes").select("content, status, exercise_name, coach_message_id").eq("id", sourceId).maybeSingle();
        if (!data) return null;
        return { note: (data.content ?? "").trim() || null, pain: null, edited: data.status === "edited", latestMessageId: data.coach_message_id ?? null, exercise: data.exercise_name ?? null };
      }
      const { data } = await sb.from("pl_workout_feedback").select("client_note, pain, pain_area, pain_level, review_edit_count, coach_message_id").eq("id", sourceId).maybeSingle();
      if (!data) return null;
      return {
        note: (data.client_note ?? "").trim() || null,
        pain: data.pain ? { area: data.pain_area ?? null, level: data.pain_level ?? null } : null,
        edited: (data.review_edit_count ?? 0) > 0,
        latestMessageId: data.coach_message_id ?? null,
        exercise: null,
      };
    },
  });
  // what it said when it was sent, until the live note loads (or if it can't be read)
  const note = live ? live.note : att.note ?? null;
  const pain = live ? live.pain : att.pain ?? null;
  const exercise = live?.exercise ?? att.exercise ?? null;
  const superseded = !!live?.latestMessageId && live.latestMessageId !== messageId;
  const removed = !!live && !note && !pain;
  const when = att.at ? safeDate(att.at) : null;

  if (superseded) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-border/70 bg-background px-3 py-2 text-[12px] text-muted-foreground" data-workout-note="superseded">
        <ArrowDown className="h-3.5 w-3.5 shrink-0" /> {source === "exercise" ? "Note updated" : "Review updated"}, see the newer note below
      </div>
    );
  }

  return (
    <div className="w-[min(78vw,320px)] overflow-hidden rounded-2xl border border-border/70 bg-background text-left text-foreground" data-workout-note={pain ? "pain" : source}>
      <div className={cn("flex items-center gap-2 px-3.5 py-2", pain ? "bg-red-500/12 text-red-600 dark:text-red-400" : "bg-muted/60 text-muted-foreground")}>
        {pain ? <AlertTriangle className="h-4 w-4 shrink-0" /> : source === "exercise" ? <StickyNote className="h-4 w-4 shrink-0" /> : <NotebookPen className="h-4 w-4 shrink-0" />}
        <span className="text-[11px] font-black uppercase tracking-[0.12em]">{pain ? "Pain flagged" : source === "exercise" ? "Exercise note" : "Workout note"}</span>
      </div>
      <div className="space-y-1.5 px-3.5 py-2.5">
        {pain && <div className="text-[15px] font-black leading-snug" data-workout-note-pain>{painLine(pain)}</div>}
        {exercise && <div className="text-[13px] font-bold">{exercise}</div>}
        {removed ? (
          <p className="text-[13px] italic text-muted-foreground">{staff ? "They removed this note." : "You removed this note."}</p>
        ) : (
          note && <p className="whitespace-pre-wrap break-words text-[14px] leading-snug">“{note}”</p>
        )}
        <div className="text-[11px] text-muted-foreground">
          {[att.workout, when && format(when, "EEE, MMM d"), live?.edited ? "edited" : null, source === "review" && att.rpe ? `effort ${att.rpe}/10` : null].filter(Boolean).join(" · ")}
        </div>
      </div>
      <div className="flex items-center gap-1 border-t border-border/60 px-2 py-1.5">
        {staff ? (
          <>
            <OpenWorkout clientId={clientId} dayId={att.day_id ?? null} rowId={att.row_id ?? null} />
            <button type="button" onClick={() => setLog(true)} className="ml-auto inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-[12px] font-bold text-muted-foreground active:bg-muted" data-workout-note-log>
              All notes <ChevronRight className="h-3.5 w-3.5" />
            </button>
            <ClientNotesSheet clientId={log ? clientId : null} onClose={() => setLog(false)} />
          </>
        ) : (
          <>
            <span className="px-1.5 text-[11px] font-semibold text-muted-foreground">Sent to your coach</span>
            {att.day_id && (
              <Link to="/portal/workouts/$dayId" params={{ dayId: att.day_id }} className="ml-auto inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-[12px] font-bold text-primary active:bg-muted">
                Workout <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function safeDate(s: string): Date | null {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
