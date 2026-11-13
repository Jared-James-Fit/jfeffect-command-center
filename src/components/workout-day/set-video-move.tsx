/**
 * Move a set video to the set it really is (set_video_move): the workout's
 * exercises, each with its set numbers as round chips (the one it's on now
 * filled, logged sets solid, sets not logged yet dashed). One tap moves the
 * clip, its chat message and its caption on the workout's film, with Undo.
 * Opened from a clip's ⋯ in the set's video sheet.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { moveChoices, type MoveExercise, type MoveSet } from "@/lib/set-videos/move";
import { setVideosKey, type SetVideo } from "@/components/workout-day/set-video-cell";

const db = supabase as any;

function useMoveChoices(dayId: string, clientId: string) {
  return useQuery({
    queryKey: ["set-video-move-sets", dayId],
    staleTime: 30_000,
    queryFn: async (): Promise<MoveExercise[]> => {
      const { data: rows, error } = await db
        .from("pl_exercise_rows")
        .select("id, sort_order, sets, exercise_name_override, exercises(name)")
        .eq("day_id", dayId);
      if (error) throw error;
      const list = (rows ?? []) as any[];
      const ids = list.map((r) => r.id);
      const { data: results, error: rErr } = ids.length
        ? await db
            .from("pl_row_results")
            .select("row_id, set_index, entered_value, entered_unit, actual_load, actual_load_unit, actual_reps, actual_rpe_num, actual_rpe, actual_rir, completed_duration_seconds, load_type")
            .in("row_id", ids)
            .eq("client_id", clientId)
        : { data: [], error: null };
      if (rErr) throw rErr;
      return moveChoices(
        list.map((r) => ({
          id: r.id,
          sort_order: r.sort_order,
          sets: r.sets,
          name: (r.exercise_name_override ?? "").trim() || r.exercises?.name || "Exercise",
        })),
        (results ?? []) as any[],
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
}: {
  video: SetVideo;
  dayId: string;
  clientId: string;
  onCancel: () => void;
  /** It left this set. */
  onMoved: () => void;
}) {
  const qc = useQueryClient();
  const { data: exercises, isLoading, isError } = useMoveChoices(dayId, clientId);
  const [busy, setBusy] = useState<string | null>(null);

  const call = async (rowId: string, set: MoveSet) => {
    const { data, error } = await db.rpc("set_video_move", {
      _id: video.id,
      _row_id: rowId,
      _set_index: set.n,
      _label: set.label || null,
      _label_no_load: set.labelNoLoad || null,
    });
    if (error) throw error;
    return data as { moved: boolean; exercise?: string; set_index?: number; set_name?: string; result_id?: string | null };
  };
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: setVideosKey(dayId) });
    void qc.invalidateQueries({ queryKey: ["messages"] });
  };

  const move = async (ex: MoveExercise, set: MoveSet) => {
    const key = `${ex.rowId}:${set.n}`;
    if (busy) return;
    setBusy(key);
    const from = exercises
      ?.find((e) => e.rowId === video.row_id)
      ?.sets.find((s) => s.n === video.set_index);
    const fromRow = video.row_id;
    try {
      const res = await call(ex.rowId, set);
      if (!res?.moved) {
        onCancel();
        return;
      }
      // on its new set at once (the read below confirms it)
      qc.setQueryData<SetVideo[]>(setVideosKey(dayId), (cur) =>
        (cur ?? []).map((x) =>
          x.id === video.id
            ? { ...x, row_id: ex.rowId, result_id: res.result_id ?? null, set_index: set.n, exercise_name: ex.name, label: set.label }
            : x,
        ),
      );
      refresh();
      onMoved();
      // the set by its name in the workout ("Top set", "Backoff 2"), as the chat now says it
      toast.success(`Moved to ${ex.name} · ${res.set_name || `Set ${set.n}`}`, {
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

  return (
    <div className="rounded-xl border border-border p-3" data-set-video-move>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Move to which set?</p>
          <p className="text-xs text-muted-foreground">It moves in your coach chat too.</p>
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
            <div key={ex.rowId} className="flex items-center gap-3" data-move-exercise={ex.name}>
              <span className="min-w-0 flex-1 truncate text-sm">{ex.name}</span>
              <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                {ex.sets.map((s) => {
                  const here = ex.rowId === video.row_id && s.n === video.set_index;
                  const key = `${ex.rowId}:${s.n}`;
                  return (
                    <button
                      key={s.n}
                      type="button"
                      disabled={here || !!busy}
                      aria-current={here ? "true" : undefined}
                      aria-label={`${ex.name}, set ${s.n}${here ? " (where it is now)" : s.label ? `, ${s.label}` : ""}`}
                      onClick={() => void move(ex, s)}
                      data-move-set={s.n}
                      className={cn(
                        "grid h-10 w-10 place-items-center rounded-full text-sm font-semibold tabular-nums transition active:scale-95 disabled:cursor-default",
                        here
                          ? "bg-foreground text-background"
                          : s.logged
                            ? "bg-muted text-foreground hover:bg-muted/70"
                            : "border border-dashed border-border text-muted-foreground",
                      )}
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
