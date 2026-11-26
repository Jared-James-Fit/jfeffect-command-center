import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { ArrowDown, ChevronRight, NotebookPen, StickyNote } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { painLine, type WorkoutNoteCardAttachment, type WorkoutNotePain } from "@/lib/workout-notes";
import { ClientNotesSheet } from "@/components/messages/client-notes-log";
import { OpenWorkout } from "@/components/messages/open-client-workout";
import { EditedToggle, NoteVersions } from "@/components/workout/shared/note-edit-history";
import type { NoteDates } from "@/lib/exercise-note-versions";
import { PainReviewSheet } from "@/components/pain/pain-review-sheet";
import { FEELS, TIMINGS, placeLabel, severityLabel, type Severity } from "@/lib/pain/report";
import { siteAnatomy } from "@/lib/pain/sites";
import { PlaceThumb } from "@/components/pain/place-thumb";
import type { PainSide } from "@/lib/pain/regions";

const sb = supabase as any;

/** One place from the review's body map (pain_reports), as the card shows it. */
type Place = { region: string; side: PainSide | null; site: string | null; name: string; score: string | null; level: number; extra: string | null; impact: string | null };

type Live = {
  note: string | null;
  pain: WorkoutNotePain | null;
  /** The review's places, each with what they added (none for a review from before the body map). */
  places?: Place[];
  edited: boolean;
  latestMessageId: string | null;
  exercise: string | null;
  /** An exercise note's dates: written, and when its words last changed. */
  dates?: NoteDates | null;
} | null;

/**
 * A note the athlete sent from a workout, in the coach chat: pain first (it's
 * what the coach must not miss), then what they wrote, the workout and when.
 * It reads the note as it is now, so an edit shows here: an exercise note's
 * edit updates this same message (the database rewrites its preview, which
 * reaches an open chat in realtime, `version`), says "Edited …" and opens its
 * earlier versions. Older notes could post a second card for a later change,
 * and that one takes over ("Updated below"). The coach can open that workout
 * or the client's whole notes log; the athlete sees it went to their coach.
 */
export function WorkoutNoteCard({ att, messageId, role, clientId, version }: {
  att: WorkoutNoteCardAttachment;
  messageId: string;
  role: "admin" | "client";
  clientId: string;
  /** The message's last update: the card reads the note again when it moves. */
  version?: string | null;
}) {
  const staff = role === "admin";
  const [log, setLog] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [painOpen, setPainOpen] = useState(false);
  const source = att.source === "exercise" ? "exercise" : "review";
  const sourceId = source === "exercise" ? att.note_id : att.feedback_id;
  const { data: live } = useQuery({
    queryKey: ["workout-note-card", source, sourceId ?? null, version ?? null],
    enabled: !!sourceId,
    staleTime: 30_000,
    // a newer version of the message reads the note again without blanking the card
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<Live> => {
      if (source === "exercise") {
        const { data } = await sb.from("pl_exercise_notes").select("content, status, exercise_name, coach_message_id, created_at, updated_at, edited_at").eq("id", sourceId).maybeSingle();
        if (!data) return null;
        return {
          note: (data.content ?? "").trim() || null,
          pain: null,
          edited: data.status === "edited" || !!data.edited_at,
          latestMessageId: data.coach_message_id ?? null,
          exercise: data.exercise_name ?? null,
          dates: { created_at: data.created_at, updated_at: data.updated_at, edited_at: data.edited_at ?? null, status: data.status },
        };
      }
      const [{ data }, { data: reports }] = await Promise.all([
        sb.from("pl_workout_feedback").select("client_note, pain, pain_area, pain_level, review_edit_count, coach_message_id").eq("id", sourceId).maybeSingle(),
        // every column (the spot, 0–10 and when it hurts came later; "*" reads them once they're there)
        sb.from("pain_reports").select("*").eq("feedback_id", sourceId).order("created_at"),
      ]);
      if (!data) return null;
      return {
        note: (data.client_note ?? "").trim() || null,
        pain: data.pain ? { area: data.pain_area ?? null, level: data.pain_level ?? null } : null,
        places: data.pain ? ((reports ?? []) as any[]).map(placeOf) : [],
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

  const places = live?.places ?? [];
  // the worst place leads the card (its picture); the rest are lines under it
  const lead = places.length ? [...places].sort((a, b) => b.level - a.level)[0] : null;
  const impact = places.find((p) => p.impact === "stopped")?.impact ?? places.find((p) => p.impact)?.impact ?? null;

  return (
    <div className="w-[min(78vw,320px)] overflow-hidden rounded-2xl border border-border/70 bg-background text-left text-foreground" data-workout-note={pain ? "pain" : source}>
      {pain ? (
        <div className="flex items-center gap-3 px-3.5 pt-3" data-recovery-card>
          {lead ? <PlaceThumb place={lead} className="h-11 w-11" /> : null}
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold leading-tight">Recovery update</p>
            <p className="truncate text-[12px] text-muted-foreground">{[att.workout, when && format(when, "EEE, MMM d")].filter(Boolean).join(" · ")}</p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 bg-muted/60 px-3.5 py-2 text-muted-foreground">
          {source === "exercise" ? <StickyNote className="h-4 w-4 shrink-0" /> : <NotebookPen className="h-4 w-4 shrink-0" />}
          <span className="text-[13px] font-semibold">{source === "exercise" ? "Exercise note" : "Workout note"}</span>
        </div>
      )}
      <div className="space-y-1.5 px-3.5 py-2.5">
        {pain && (places.length ? (
          <ul className="space-y-1.5" data-workout-note-pain>
            {places.map((p, i) => (
              <li key={i} className="leading-snug">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 text-[15px] font-semibold">{p.name}</span>
                  {p.score && <span className={cn("shrink-0 text-[14px] font-semibold tabular-nums", p.level >= 6 ? "text-warning" : "text-foreground")}>{p.score}</span>}
                </span>
                {p.extra && <span className="block text-[12px] text-muted-foreground">{p.extra}</span>}
              </li>
            ))}
            {impact && (
              <li className="pt-0.5 text-[12px] text-muted-foreground" data-recovery-impact>
                Training impact: <span className="font-semibold text-foreground">{impact === "stopped" ? "had to stop" : "changed the session"}</span>
              </li>
            )}
          </ul>
        ) : (
          <div className="text-[15px] font-semibold leading-snug" data-workout-note-pain>{painLine(pain)}</div>
        ))}
        {exercise && <div className="text-[13px] font-bold">{exercise}</div>}
        {removed ? (
          <p className="text-[13px] italic text-muted-foreground">{staff ? "They removed this note." : "You removed this note."}</p>
        ) : (
          note && <p className="whitespace-pre-wrap break-words text-[14px] leading-snug">“{note}”</p>
        )}
        <div className="flex flex-wrap items-center gap-x-1 text-[11px] text-muted-foreground">
          <span>{[pain ? null : att.workout, pain ? null : when && format(when, "EEE, MMM d"), source === "review" && live?.edited ? "edited" : null, source === "review" && att.rpe ? `effort ${att.rpe}/10` : null].filter(Boolean).join(" · ")}</span>
          {source === "exercise" && live?.dates && live.edited && (
            <>
              <span aria-hidden>·</span>
              <EditedToggle note={live.dates} open={versionsOpen} onToggle={() => setVersionsOpen((v) => !v)} />
            </>
          )}
        </div>
        {source === "exercise" && live?.dates && (
          <NoteVersions noteId={sourceId} note={live.dates} open={versionsOpen} className="mt-1" />
        )}
      </div>
      <div className="flex items-center gap-1 border-t border-border/60 px-2 py-1.5">
        {staff ? (
          <>
            <OpenWorkout clientId={clientId} dayId={att.day_id ?? null} rowId={att.row_id ?? null} />
            {pain && (
              <button type="button" onClick={() => setPainOpen(true)} className="ml-auto inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-[12px] font-semibold text-foreground active:bg-muted" data-workout-note-pain-history>
                Open report <ChevronRight className="h-3.5 w-3.5" />
              </button>
            )}
            {!pain && (
              <button type="button" onClick={() => setLog(true)} className="ml-auto inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-[12px] font-bold text-muted-foreground active:bg-muted" data-workout-note-log>
                All notes <ChevronRight className="h-3.5 w-3.5" />
              </button>
            )}
            <ClientNotesSheet clientId={log ? clientId : null} onClose={() => setLog(false)} coachNotes />
            {pain && <PainReviewSheet clientId={painOpen ? clientId : null} onClose={() => setPainOpen(false)} inChat />}
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

function placeOf(r: any): Place {
  const feel = ((r.feel ?? []) as string[]).map((f) => FEELS.find((x) => x.v === f)?.label.toLowerCase() ?? f);
  const when = ((r.timing ?? []) as string[]).map((t) => TIMINGS.find((x) => x.v === t)?.label.toLowerCase() ?? t);
  const anat = siteAnatomy(r.site);
  const side: PainSide | null = r.side === "L" || r.side === "R" ? r.side : null;
  const extra = [
    anat,
    r.same_issue && r.change ? `${r.change} than last time` : r.same_issue === false ? "new" : null,
    feel.length ? feel.join(", ") : null,
    when.length ? when.join(", ") : null,
    r.exercise_name,
    r.region !== "other" && r.note ? `“${r.note}”` : null,
  ].filter(Boolean).join(" · ");
  const score = typeof r.score === "number" ? r.score : null;
  const level = score ?? (r.severity === "severe" ? 8 : r.severity === "moderate" ? 5 : 3);
  return {
    region: r.region,
    side,
    site: r.site ?? null,
    name: placeLabel({ region: r.region, side, site: r.site ?? null, note: r.note, symptom: r.symptom ?? null }),
    score: score != null ? `${score}/10` : severityLabel((r.severity as Severity) ?? null),
    level,
    extra: extra || null,
    impact: r.impact === "stopped" || r.impact === "modified" ? r.impact : null,
  };
}

function safeDate(s: string): Date | null {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
