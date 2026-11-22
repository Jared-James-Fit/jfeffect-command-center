/**
 * Move a set video to the set it really is (set_video_move): the workout's
 * exercises (a repeated one by its role, "· Backoff"), each with its warm-ups
 * (a flame, numbered when there are several) and its set numbers as round chips (the one it's on now
 * filled, logged ones solid, ones not logged yet dashed). One tap moves the
 * clip, its chat message and its caption on the workout's film, with Undo.
 * Opened from a clip's ⋯ in the set's video sheet.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Flame, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { moveChoices, warmupChipNumber, type MoveExercise, type MoveSet, type MoveWarmup } from "@/lib/set-videos/move";
import { setVideosKey, type SetVideo } from "@/components/workout-day/set-video-cell";
import { UNLINKED_SET_VIDEO_MS } from "@/lib/set-videos/jobs";

const db = supabase as any;

function useMoveChoices(dayId: string, clientId: string) {
  return useQuery({
    queryKey: ["set-video-move-sets", dayId],
    staleTime: 30_000,
    queryFn: async (): Promise<MoveExercise[]> => {
      const { data: rows, error } = await db
        .from("pl_exercise_rows")
        .select("id, sort_order, sets, reps_text, purpose_label, notes, exercise_name_override, exercises(name)")
        .eq("day_id", dayId);
      if (error) throw error;
      const list = (rows ?? []) as any[];
      const ids = list.map((r) => r.id);
      const [res, warm] = ids.length
        ? await Promise.all([
            db
              .from("pl_row_results")
              .select("row_id, set_index, entered_value, entered_unit, actual_load, actual_load_unit, actual_reps, actual_rpe_num, actual_rpe, actual_rir, completed_duration_seconds, load_type, is_bodyweight")
              .in("row_id", ids)
              .eq("client_id", clientId),
            db.from("pl_warmup_sets").select("id, row_id, load, unit, reps, rpe, created_at").in("row_id", ids).eq("client_id", clientId),
          ])
        : [{ data: [], error: null }, { data: [], error: null }];
      if (res.error) throw res.error;
      if (warm.error) throw warm.error;
      return moveChoices(
        list.map((r) => ({
          id: r.id,
          sort_order: r.sort_order,
          sets: r.sets,
          reps_text: r.reps_text,
          purpose_label: r.purpose_label,
          notes: r.notes,
          name: (r.exercise_name_override ?? "").trim() || r.exercises?.name || "Exercise",
        })),
        (res.data ?? []) as any[],
        (warm.data ?? []) as any[],
      );
    },
  });
}

export function SetVideoMovePicker({
  video,
  dayId,
  clientId,
  onCancel,
  onMoved,
  chat = false,
}: {
  video: SetVideo;
  dayId: string;
  clientId: string;
  onCancel: () => void;
  /** It left this set. */
  onMoved: () => void;
  /** A video sent in the coach chat, put on its set: working sets only, the chat's own words kept. */
  chat?: boolean;
}) {
  const qc = useQueryClient();
  const { data: exercises, isLoading, isError } = useMoveChoices(dayId, clientId);
  const [busy, setBusy] = useState<string | null>(null);
  // a clip waits on a set or warm-up that isn't logged yet only while it's fresh (videoOnSet, and the
  // database's link when it's logged); an older one goes only onto a logged one, or it would drop out of view
  const waitsOk = Date.now() - Date.parse(video.created_at) < UNLINKED_SET_VIDEO_MS;

  /** Where a clip goes: a working set, or a warm-up (set 0: a logged one by id, else the one still to log). */
  type Spot = { n: number; label: string; labelNoLoad: string; warmupId: string | null };
  const spotOfSet = (set: MoveSet): Spot => ({ n: set.n, label: set.label, labelNoLoad: set.labelNoLoad, warmupId: null });
  const spotOfWarmup = (w: MoveWarmup): Spot => ({ n: 0, label: w.label, labelNoLoad: "", warmupId: w.id });
  const call = async (rowId: string, spot: Spot) => {
    const { data, error } = await db.rpc("set_video_move", {
      _id: video.id,
      _row_id: rowId,
      _set_index: spot.n,
      _label: spot.label || null,
      _label_no_load: spot.labelNoLoad || null,
      ...(spot.n === 0 ? { _warmup_id: spot.warmupId } : {}),
    });
    if (error) throw error;
    return data as { moved: boolean; exercise?: string; set_index?: number; set_name?: string; result_id?: string | null; warmup_id?: string | null };
  };
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: setVideosKey(dayId) });
    void qc.invalidateQueries({ queryKey: ["messages"] });
  };

  // where it is now, to put it back with Undo: its warm-up, or its set and that set's numbers
  const fromSpot = (): Spot | null => {
    const ex = exercises?.find((e) => e.rowId === video.row_id);
    if (!video.row_id) return null;
    if (video.set_index === 0) {
      const w = ex?.warmups.find((x) => x.id === (video.warmup_id ?? null));
      return { n: 0, label: w?.label ?? video.label ?? "", labelNoLoad: "", warmupId: video.warmup_id ?? null };
    }
    const s = ex?.sets.find((x) => x.n === video.set_index);
    return s ? spotOfSet(s) : null;
  };

  const move = async (ex: MoveExercise, spot: Spot) => {
    const key = `${ex.rowId}:${spot.n}:${spot.warmupId ?? ""}`;
    if (busy) return;
    setBusy(key);
    const from = fromSpot();
    const fromRow = video.row_id;
    try {
      const res = await call(ex.rowId, spot);
      if (!res?.moved) {
        onCancel();
        return;
      }
      // on its new set or warm-up at once (the read below confirms it)
      qc.setQueryData<SetVideo[]>(setVideosKey(dayId), (cur) =>
        (cur ?? []).map((x) =>
          x.id === video.id
            ? {
                ...x,
                row_id: ex.rowId,
                result_id: spot.n === 0 ? null : (res.result_id ?? null),
                warmup_id: spot.n === 0 ? (res.warmup_id ?? spot.warmupId) : null,
                set_index: spot.n,
                exercise_name: ex.exercise,
                label: spot.label,
              }
            : x,
        ),
      );
      refresh();
      onMoved();
      // the set by its name in the workout ("Top set", "Backoff 2", "Warm-up"), as the chat now says it
      toast.success(`Moved to ${ex.name} · ${res.set_name || (spot.n === 0 ? "Warm-up" : `Set ${spot.n}`)}`, {
        action:
          fromRow && from
            ? {
                label: "Undo",
                onClick: () => {
                  void call(fromRow, from).then(refresh, () => toast.error("Couldn't move it back. Try again."));
                },
              }
            : undefined,
      });
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "Couldn't move it. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const chip = (here: boolean, logged: boolean) =>
    cn(
      "grid h-10 min-w-10 place-items-center rounded-full px-2 text-sm font-semibold tabular-nums transition active:scale-95 disabled:cursor-default",
      here
        ? "bg-foreground text-background"
        : logged
          ? "bg-muted text-foreground hover:bg-muted/70"
          : "border border-dashed border-border text-muted-foreground disabled:opacity-40",
    );

  return (
    <div className="rounded-xl border border-border p-3" data-set-video-move>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{chat ? "Which set is this?" : "Move to which set?"}</p>
          <p className="text-xs text-muted-foreground">
            {chat
              ? "Its bar speed goes on that set."
              : "W is a warm-up. It moves in your coach chat too."}
            {waitsOk ? "" : " Only sets already logged, since it's an older clip."}
          </p>
        </div>
        <Button size="sm" variant="ghost" className="h-10 shrink-0" onClick={onCancel} disabled={!!busy}>
          Cancel
        </Button>
      </div>
      {isLoading ? (
        <div className="flex h-20 items-center justify-center text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        </div>
      ) : isError || !exercises?.length ? (
        <p className="mt-3 text-sm text-muted-foreground">Couldn't load this workout's sets. Check your connection and try again.</p>
      ) : (
        <div className="mt-3 space-y-2.5">
          {exercises.map((ex) => (
            // the name keeps room to read whole; when the chips don't fit beside it they take the line under it
            <div key={ex.rowId} className="flex flex-wrap items-center gap-x-3 gap-y-1.5" data-move-exercise={ex.name}>
              <span className="min-w-[9rem] flex-1 break-words text-sm leading-snug">{ex.name}</span>
              <div className="ml-auto flex flex-wrap justify-end gap-1.5">
                {(chat ? [] : ex.warmups).map((w, i) => {
                  const here = ex.rowId === video.row_id && video.set_index === 0 && (video.warmup_id ?? null) === w.id;
                  const spot = spotOfWarmup(w);
                  const key = `${ex.rowId}:0:${w.id ?? ""}`;
                  const num = warmupChipNumber(ex.warmups, i);
                  return (
                    <button
                      key={`w-${w.id ?? "open"}`}
                      type="button"
                      disabled={here || !!busy || (!w.logged && !waitsOk)}
                      aria-current={here ? "true" : undefined}
                      aria-label={`${ex.name}, warm-up${ex.warmups.length > 1 ? ` ${i + 1}` : ""}${here ? " (where it is now)" : w.label ? `, ${w.label}` : w.logged ? "" : ", not logged yet"}`}
                      title={w.label || (w.logged ? "Warm-up" : "Warm-up · not logged yet")}
                      onClick={() => void move(ex, spot)}
                      data-move-warmup={w.id ?? "open"}
                      className={chip(here, w.logged)}
                    >
                      {busy === key ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <span className="inline-flex items-center gap-0.5"><Flame className="h-3.5 w-3.5" aria-hidden />{num}</span>}
                    </button>
                  );
                })}
                {ex.sets.map((s) => {
                  const here = ex.rowId === video.row_id && s.n === video.set_index;
                  const key = `${ex.rowId}:${s.n}:`;
                  return (
                    <button
                      key={s.n}
                      type="button"
                      disabled={here || !!busy || (!s.logged && !waitsOk)}
                      aria-current={here ? "true" : undefined}
                      aria-label={`${ex.name}, set ${s.n}${here ? " (where it is now)" : s.label ? `, ${s.label}` : ""}`}
                      title={s.label || undefined}
                      onClick={() => void move(ex, spotOfSet(s))}
                      data-move-set={s.n}
                      className={chip(here, s.logged)}
                    >
                      {busy === key ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : s.n}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
