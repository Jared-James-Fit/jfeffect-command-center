/**
 * Dev-only A/B probe for the member workout adapter.
 *
 * Mounted from the member workout route. When the user opts in via
 * `localStorage.unified_member_adapter = "1"` (set in DevTools), the probe
 * builds a `member`-kind WorkoutContextAdapter for the active enrollment and
 * exercises a handful of read paths against the real day. Results render
 * in a small fixed-position badge and any thrown error is logged to the
 * console so we can diff adapter output vs the legacy direct-`supabase`
 * reads without changing the user-facing UI.
 *
 * This is intentionally read-only: no writes, no schedule mutations. The
 * existing `WorkoutTracker` keeps rendering and remains the source of
 * truth. Flag off => component returns `null` and short-circuits.
 */
import { useEffect, useState } from "react";
import { buildWorkoutAdapter } from "@/lib/workout-context";
import { supabase } from "@/integrations/supabase/client";

const STORAGE_KEY = "unified_member_adapter";

function flagOn(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

type ProbeState =
  | { status: "idle" }
  | { status: "running" }
  | {
      status: "ok";
      rows: number;
      results: number;
      completion: boolean;
      day: string | null;
      drift: string[];
    }
  | { status: "error"; message: string };

export function MemberAdapterProbe({
  userId,
  enrollmentId,
  week,
  day,
}: {
  userId: string | null | undefined;
  enrollmentId: string;
  week: number;
  day: number;
}) {
  const enabled = flagOn();
  const [state, setState] = useState<ProbeState>({ status: "idle" });

  useEffect(() => {
    if (!enabled || !userId) return;
    let cancelled = false;
    setState({ status: "running" });
    (async () => {
      try {
        const adapter = buildWorkoutAdapter({
          kind: "member",
          userId,
          ownerId: userId,
          enrollmentId,
        });
        const dayId = `${week}:${day}`;
        const [dayDto, rows, results, completion, directLogs, directCompletion] = await Promise.all([
          adapter.getDay(dayId),
          adapter.listRows(dayId),
          adapter.listRowResults(dayId),
          adapter.getDayCompletion(dayId),
          supabase
            .from("member_set_logs")
            .select("exercise_index, set_index, reps, load_lb, rpe, rir")
            .eq("enrollment_id", enrollmentId)
            .eq("week_index", week)
            .eq("day_index", day),
          supabase
            .from("member_workout_completions")
            .select("completed_at")
            .eq("enrollment_id", enrollmentId)
            .eq("week_index", week)
            .eq("day_index", day)
            .maybeSingle(),
        ]);
        if (cancelled) return;
        // Shadow-compare adapter output against the legacy direct reads.
        // Drift here means the adapter is diverging from what WorkoutTracker
        // sees and we should NOT flip reads behind it yet.
        const drift: string[] = [];
        const directLogRows = (directLogs.data ?? []) as any[];
        if (directLogRows.length !== results.length) {
          drift.push(`logs count ${results.length} vs direct ${directLogRows.length}`);
        } else {
          const adapterKeys = new Set(
            results.map((r) => `${r.rowId}:${r.setIndex}:${r.reps ?? ""}:${r.loadLb ?? ""}`),
          );
          for (const l of directLogRows) {
            const k = `ex:${l.exercise_index}:${l.set_index}:${l.reps ?? ""}:${l.load_lb ?? ""}`;
            if (!adapterKeys.has(k)) {
              drift.push(`log ex:${l.exercise_index}/set:${l.set_index} mismatch`);
              break;
            }
          }
        }
        const directCompleted = !!(directCompletion.data as any)?.completed_at;
        const adapterCompleted = !!completion?.completedAt;
        if (directCompleted !== adapterCompleted) {
          drift.push(`completion ${adapterCompleted} vs direct ${directCompleted}`);
        }
        if (drift.length) {
          // eslint-disable-next-line no-console
          console.warn("[member-adapter-probe] drift", { enrollmentId, week, day, drift });
        }
        // eslint-disable-next-line no-console
        console.info("[member-adapter-probe]", {
          enrollmentId,
          week,
          day,
          dayDto,
          rows,
          results,
          completion,
          drift,
        });
        setState({
          status: "ok",
          rows: rows.length,
          results: results.length,
          completion: !!completion?.completedAt,
          day: dayDto.title,
          drift,
        });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.error("[member-adapter-probe] failed", err);
        setState({ status: "error", message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, userId, enrollmentId, week, day]);

  if (!enabled) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 max-w-[260px] rounded-md border border-amber-500/40 bg-amber-950/90 px-3 py-2 text-[11px] font-mono text-amber-100 shadow-lg">
      <div className="font-semibold tracking-wide">adapter probe</div>
      {state.status === "idle" && <div>idle</div>}
      {state.status === "running" && <div>running…</div>}
      {state.status === "ok" && (
        <div className="space-y-0.5">
          <div>day: {state.day ?? "(untitled)"}</div>
          <div>rows: {state.rows}</div>
          <div>logs: {state.results}</div>
          <div>completed: {state.completion ? "yes" : "no"}</div>
          <div className={state.drift.length ? "text-red-300" : "text-emerald-300"}>
            drift: {state.drift.length === 0 ? "none ✓" : `${state.drift.length} ⚠`}
          </div>
        </div>
      )}
      {state.status === "error" && (
        <div className="text-amber-200">err: {state.message}</div>
      )}
    </div>
  );
}